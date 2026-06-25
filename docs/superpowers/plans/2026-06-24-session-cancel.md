# Session Cancel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A server-side `sessions.cancel(sessionId)` endpoint that aborts an in-flight turn — not just the originating client's AbortSignal (gap-analysis R9). Works across instances via a Redis pubsub registry (decision #1), in-memory by default.

**Architecture:** A `CancellationRegistry` port (mirrors `session-lock`/`pending-store`): the agent package owns the interface + in-memory impl; `apps/server` adds the Redis impl and selects by `env.REDIS_URL`. `runTurn` creates a server-side `AbortController`, merges it with the caller's signal via `AbortSignal.any`, registers it under the sessionId for the turn's lifetime, and unregisters in `finally`. The `cancel` endpoint calls `registry.cancel(sessionId)` → aborts the live controller (locally, or on whichever instance holds it via pubsub).

**Tech Stack:** TypeScript, oRPC, AI SDK v6, ioredis (`catalog:`), ioredis-mock, vitest. Node ≥20 (`AbortSignal.any`).

## Global Constraints

- `ioredis` must NOT enter `packages/agent` — Redis impl lives in `apps/server` behind the interface.
- `cancellation` is an OPTIONAL `SessionRuntimeDeps` field (absent → no registration; existing runtime tests unaffected) but a REQUIRED `AgentServices` field (the endpoint needs it; server always wires one).
- Aborting a turn reuses the existing abort path (`runAttempt` catch / drain `abort` chunk → `status:"aborted"`) — do NOT change abort handling.
- Functions ≤50, file ≤300, no `any`, kebab-case, conventional-commits, footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Commit bare/redirected — never pipe `git commit` through grep/head (SIGPIPE aborts it).

---

### Task 1: Cancellation registry + runtime + endpoints (single-instance)

**Files:**
- Create: `packages/agent/src/session/cancellation.ts`
- Create test: `packages/agent/src/session/cancellation.test.ts`
- Modify: `packages/agent/src/session/runtime.ts` (`SessionRuntimeDeps.cancellation?`, `runTurn` merge-signal + register/unregister)
- Create test: `packages/agent/src/session/runtime-cancel.test.ts`
- Modify: `packages/api/src/routers/sessions.ts` + `user-sessions.ts` (`cancel` endpoint)
- Modify: `packages/api/src/services.ts` (`AgentServices.cancellation`)
- Modify: `apps/server/src/index.ts` (wire in-memory registry into services + runtime)

**Interfaces:**
- Produces: `CancellationRegistry` (`register(sessionId, controller)`, `unregister(sessionId)`, `cancel(sessionId): Promise<void>`), `createInMemoryCancellationRegistry()`.

- [ ] **Step 1: Create `cancellation.ts`**

```ts
export interface CancellationRegistry {
	/** Track a live turn's controller so cancel() can abort it. */
	register(sessionId: string, controller: AbortController): void;
	unregister(sessionId: string): void;
	/** Abort the in-flight turn for this session (no-op if none on this instance). */
	cancel(sessionId: string): Promise<void>;
}

export function createInMemoryCancellationRegistry(): CancellationRegistry {
	const active = new Map<string, AbortController>();
	return {
		register(sessionId, controller) {
			active.set(sessionId, controller);
		},
		unregister(sessionId) {
			active.delete(sessionId);
		},
		cancel(sessionId) {
			active.get(sessionId)?.abort();
			return Promise.resolve();
		},
	};
}
```

- [ ] **Step 2: Unit tests `cancellation.test.ts`**

```ts
import { expect, it } from "vitest";
import { createInMemoryCancellationRegistry } from "./cancellation";

it("aborts the registered controller", async () => {
	const reg = createInMemoryCancellationRegistry();
	const c = new AbortController();
	reg.register("s1", c);
	await reg.cancel("s1");
	expect(c.signal.aborted).toBe(true);
});

it("is a no-op after unregister", async () => {
	const reg = createInMemoryCancellationRegistry();
	const c = new AbortController();
	reg.register("s1", c);
	reg.unregister("s1");
	await reg.cancel("s1");
	expect(c.signal.aborted).toBe(false);
});

it("cancel for an unknown session does not throw", async () => {
	const reg = createInMemoryCancellationRegistry();
	await expect(reg.cancel("nope")).resolves.toBeUndefined();
});
```

Run: `pnpm -F @better-agent/agent test -- cancellation` → PASS.

- [ ] **Step 3: Integrate in `runtime.ts`**

Import the type, add the optional dep, and rewrite `createSessionRuntime`'s `runTurn`:

```ts
import type { CancellationRegistry } from "./cancellation";
```
Add to `SessionRuntimeDeps`: `cancellation?: CancellationRegistry;`

```ts
export function createSessionRuntime(deps: SessionRuntimeDeps): SessionRuntime {
	return {
		async *runTurn(input) {
			if (!(await deps.sessionLock.acquire(input.sessionId))) {
				throw new SessionBusyError(input.sessionId);
			}
			const controller = new AbortController();
			const abortSignal = input.abortSignal
				? AbortSignal.any([input.abortSignal, controller.signal])
				: controller.signal;
			deps.cancellation?.register(input.sessionId, controller);
			try {
				return yield* executeTurn(deps, { ...input, abortSignal });
			} finally {
				deps.cancellation?.unregister(input.sessionId);
				await deps.sessionLock.release(input.sessionId);
			}
		},
	};
}
```

- [ ] **Step 4: Runtime test `runtime-cancel.test.ts`**

Verify the runtime registers a controller and that cancelling it aborts the turn. Use a fake cancellation registry that captures the controller, and a model whose `doStream` waits on the abort signal. Simplest robust assertion: inject a spy registry, run a normal (happy) turn, assert `register` then `unregister` were called with the sessionId.

```ts
import type { LanguageModelV3, LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { expect, it } from "vitest";
import type { ModelFactory } from "../provider/model-factory";
import type { CancellationRegistry } from "./cancellation";
import { createFakeAgentStore } from "../testing/fake-agent-store";
import {
	createFakeCatalogStore, createFakeMessageStore, createFakeModelStore,
	createFakeSessionStore, createFakeSummarizer,
} from "../testing/fakes";
import type { RunEvent } from "./events";
import { createSessionRuntime } from "./runtime";
import { createInMemorySessionLock } from "./session-lock";
import type { Message } from "./types";

const IN = 5;
const OUT = 2;
const HAPPY: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" }, { type: "text-delta", id: "0", delta: "hi" }, { type: "text-end", id: "0" },
	{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: IN, noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: OUT, text: undefined, reasoning: undefined } } },
];

function spyRegistry(): CancellationRegistry & { registered: string[]; unregistered: string[] } {
	const registered: string[] = [];
	const unregistered: string[] = [];
	return {
		registered, unregistered,
		register(sessionId) { registered.push(sessionId); },
		unregister(sessionId) { unregistered.push(sessionId); },
		cancel() { return Promise.resolve(); },
	};
}

async function drain(gen: AsyncGenerator<RunEvent, Message>) {
	let n = await gen.next();
	while (!n.done) { n = await gen.next(); }
}

it("registers then unregisters the session around the turn", async () => {
	const agentStore = createFakeAgentStore();
	const sessionStore = createFakeSessionStore();
	const messageStore = createFakeMessageStore();
	const agent = await agentStore.create({ name: "H", description: "d", systemPrompt: "s", providerId: "openai", modelId: "gpt-x", params: null, tokenHash: "h-cancel" });
	const session = await sessionStore.create({ agentId: agent.id });
	const cancellation = spyRegistry();
	const model: LanguageModelV3 = new MockLanguageModelV3({ doStream: () => Promise.resolve({ stream: simulateReadableStream({ chunks: HAPPY }) }) });
	const runtime = createSessionRuntime({
		sessionStore, messageStore, agentStore,
		modelFactory: { create: () => Promise.resolve(model) } as ModelFactory,
		sessionLock: createInMemorySessionLock(),
		modelCacheStore: createFakeModelStore(), providerCatalogStore: createFakeCatalogStore(),
		summarizer: createFakeSummarizer(), cancellation,
	});
	await drain(runtime.runTurn({ sessionId: session.id, text: "go" }));
	expect(cancellation.registered).toEqual([session.id]);
	expect(cancellation.unregistered).toEqual([session.id]);
});
```

Run: `pnpm -F @better-agent/agent test -- runtime-cancel` → PASS.

- [ ] **Step 5: Add the `cancel` endpoint to both routers**

In `packages/api/src/routers/sessions.ts`, add to `sessionsRouter` (uses the existing `sessionIdInput` + `requireOwnedSession`):

```ts
	cancel: agentProcedure
		.input(sessionIdInput)
		.handler(async ({ input, context }) => {
			await requireOwnedSession(context, context.authedAgent.id, input.sessionId);
			await context.services.cancellation.cancel(input.sessionId);
			return { ok: true };
		}),
```

In `packages/api/src/routers/user-sessions.ts`, mirror with `requireUserSession(context, context.authedUser.id, input.sessionId)` and `context.services.cancellation.cancel(input.sessionId)`.

- [ ] **Step 6: Add `cancellation` to `AgentServices`**

In `packages/api/src/services.ts`, add `cancellation: CancellationRegistry;` to the `AgentServices` interface (import the type from `@better-agent/agent/session/cancellation`).

- [ ] **Step 7: Wire in-memory registry in `apps/server/src/index.ts`**

```ts
import { createInMemoryCancellationRegistry } from "@better-agent/agent/session/cancellation";
```
Create one shared registry, pass it to BOTH `buildRuntime` (as `cancellation`) and `buildServices` (as `services.cancellation`) — they must be the SAME instance so the endpoint cancels the runtime's controllers. Add a `cancellation` param to `buildRuntime`, set `cancellation` in the `createSessionRuntime({...})` deps, and add `cancellation` to the services object returned by `buildServices`.

- [ ] **Step 8: Verify + commit**

```bash
pnpm -F @better-agent/agent check-types && pnpm check-types
pnpm -F @better-agent/agent test
pnpm exec biome lint packages/agent/src/session/cancellation.ts packages/agent/src/session/cancellation.test.ts packages/agent/src/session/runtime.ts packages/agent/src/session/runtime-cancel.test.ts packages/api/src/routers/sessions.ts packages/api/src/routers/user-sessions.ts packages/api/src/services.ts apps/server/src/index.ts
git add packages/agent/src/session/cancellation.ts packages/agent/src/session/cancellation.test.ts packages/agent/src/session/runtime.ts packages/agent/src/session/runtime-cancel.test.ts packages/api/src/routers/sessions.ts packages/api/src/routers/user-sessions.ts packages/api/src/services.ts apps/server/src/index.ts
git commit -m "$(printf 'feat(api): server-side session cancel endpoint\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: agent + root tsc clean, all tests pass, lint clean.

---

### Task 2: Redis cancellation registry (cross-instance)

**Files:**
- Create: `apps/server/src/redis-cancellation.ts`
- Create test: `apps/server/src/redis-cancellation.test.ts`
- Modify: `apps/server/src/index.ts` (select Redis vs in-memory by `env.REDIS_URL`)

**Interfaces:**
- Consumes: `CancellationRegistry` from `@better-agent/agent/session/cancellation`.
- Produces: `createRedisCancellationRegistry(redis: Redis): CancellationRegistry`.

- [ ] **Step 1: Implement `redis-cancellation.ts`**

Single broadcast channel; every instance keeps a local map and aborts if it holds the session. Mirrors `redis-pending-store.ts` style (duplicate subscriber, error logging).

```ts
import type { CancellationRegistry } from "@better-agent/agent/session/cancellation";
import { log } from "evlog";
import type { Redis } from "ioredis";

const CANCEL_CHANNEL = "session-cancel";

export function createRedisCancellationRegistry(redis: Redis): CancellationRegistry {
	const subscriber = redis.duplicate();
	const active = new Map<string, AbortController>();

	const onError = (err: Error) =>
		log.error({ action: "redis cancellation error", error: String(err) });
	redis.on("error", onError);
	subscriber.on("error", onError);

	subscriber.on("message", (_channel: string, sessionId: string) => {
		active.get(sessionId)?.abort();
		active.delete(sessionId);
	});
	subscriber.subscribe(CANCEL_CHANNEL);

	return {
		register(sessionId, controller) {
			active.set(sessionId, controller);
		},
		unregister(sessionId) {
			active.delete(sessionId);
		},
		async cancel(sessionId) {
			await redis.publish(CANCEL_CHANNEL, sessionId);
		},
	};
}
```

- [ ] **Step 2: Test `redis-cancellation.test.ts`** (ioredis-mock shares the bus across instances)

```ts
import RedisMock from "ioredis-mock";
import { expect, it } from "vitest";
import { createRedisCancellationRegistry } from "./redis-cancellation";

const SETTLE_MS = 10;

it("cancels a controller held on another instance via pubsub", async () => {
	const a = new RedisMock();
	const b = new RedisMock();
	const regA = createRedisCancellationRegistry(a);
	const regB = createRedisCancellationRegistry(b);
	const c = new AbortController();
	regA.register("s1", c);
	await regB.cancel("s1");
	await new Promise<void>((r) => setTimeout(r, SETTLE_MS));
	expect(c.signal.aborted).toBe(true);
});

it("cancel for a session no instance holds is a no-op", async () => {
	const a = new RedisMock();
	const reg = createRedisCancellationRegistry(a);
	await expect(reg.cancel("ghost")).resolves.toBeUndefined();
});
```

Run: `pnpm -F server test -- redis-cancellation` → PASS.

- [ ] **Step 3: Select by `env.REDIS_URL` in `apps/server/src/index.ts`**

Replace the in-memory construction from Task 1 Step 7 with a builder mirroring `buildPendingToolCallStore`:

```ts
import { createRedisCancellationRegistry } from "./redis-cancellation";

function buildCancellation() {
	return env.REDIS_URL
		? createRedisCancellationRegistry(new Redis(env.REDIS_URL))
		: createInMemoryCancellationRegistry();
}
```
Use the SAME returned instance for both `buildRuntime` and the services object (call `buildCancellation()` once in `buildServices`, store in a local, pass to both).

- [ ] **Step 4: Verify + commit**

```bash
pnpm -F server check-types
pnpm -F server test -- redis-cancellation
pnpm exec biome lint apps/server/src/redis-cancellation.ts apps/server/src/redis-cancellation.test.ts apps/server/src/index.ts
git add apps/server/src/redis-cancellation.ts apps/server/src/redis-cancellation.test.ts apps/server/src/index.ts
git commit -m "$(printf 'feat(server): redis-backed cross-instance session cancel\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: server tsc clean, redis-cancellation tests pass, lint clean.

---

## Self-Review Notes

- **Coverage:** R9 server cancel → endpoint (T1 S5) + registry (T1 S1) + runtime register/abort (T1 S3); decision #1 cross-instance → Redis (T2).
- **Type consistency:** `CancellationRegistry` identical across cancellation.ts, runtime.ts (dep), services.ts (AgentServices), both routers (`context.services.cancellation.cancel`), redis impl. `cancel` returns `Promise<void>` everywhere (async for Redis).
- **Same-instance invariant:** server wires ONE registry into both runtime deps and services so the endpoint aborts the runtime's live controllers — called out explicitly in T1 S7 / T2 S3.
- **Ordering:** T1 ships a working single-instance feature; T2 swaps the impl for cross-instance. T1 before T2.
- **YAGNI:** broadcast channel (no per-session subscribe churn); reuse existing abort path; no new abort status handling.
