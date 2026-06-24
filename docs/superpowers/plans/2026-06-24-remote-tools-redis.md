# Remote Tools + Redis Pending Store (T2) Implementation Plan

> **Plan B of 3** for the tool system. Plan A (tool loop core, in-process tools) is merged. Plan C = prompt caching + accounting (T3 + 3.4). This plan adds **client-executed (remote) tools**: the client sends tool *definitions*, the model calls them, the server parks the call on a pending store and waits, the client runs the tool locally and posts the result back via `submitToolResult`, multi-instance-coordinated over Redis pub/sub.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an external system define and execute its own tools while the server orchestrates: the model's tool call is surfaced to the client as a `tool-call` event, the server's tool `execute` parks until the client calls `submitToolResult`, then the multi-step loop continues — working across multiple server instances via Redis pub/sub.

**Architecture:** A `PendingToolCallStore` port: `park({sessionId,callId,abortSignal})` returns a Promise that resolves when `resolve({sessionId,callId,result})` is called (possibly on another instance). Two impls: in-memory (single instance / tests) and Redis pub/sub (`resolve` PUBLISHes to `toolresult:{sessionId}:{callId}`; the instance that parked is SUBSCRIBEd and resolves its local Promise). The api builds **remote `ToolDef`s** from client-sent `{name,description,parameters}` whose `execute` parks on the store, and threads them through the existing `RunTurnInput.tools` — **the runtime is unchanged.** A new `sessions.submitToolResult` endpoint resolves the store. The client SDK gains `RunOptions.tools`: on a `tool-call` event it runs the matching local tool and posts the result.

**Tech Stack:** TypeScript, `ioredis` (pub/sub), oRPC (the existing stateless `RPCLink` — `submitToolResult` is a concurrent unary call while the stream is open), Vitest (in-memory store unit-tested; Redis impl tested against `ioredis-mock` or a real local Redis), the AI-SDK tool machinery from Plan A.

**Source design (validated):** `docs/research/agent-gap-analysis.md` §3.1.6 (remote tools), decision #1 (multi-instance via Redis, ports-injected, in-memory/Redis swappable). Survey of seams confirms the runtime needs no change.

## Global Constraints

- **Decisions (binding):**
  - **Pending store is a port**; ship BOTH the in-memory impl (`packages/agent`, pure) and the **Redis pub/sub impl** (`apps/server`, owns the `ioredis` dep — mirrors how the Resend sender lives in `apps/server`). The server selects Redis when `REDIS_URL` is set, else in-memory.
  - **The store lives on `AgentServices`, NOT `SessionRuntimeDeps`** — the runtime is unchanged. The api streamTurn builds remote `ToolDef`s from it; `submitToolResult` resolves it.
  - **Pending call timeout** `PENDING_TTL_MS = 120_000` (2 min): `park` rejects if no result arrives (the rejection surfaces as a normal tool error via Plan A's `tool-error` handling — i.e. the turn continues with an error result, it does not crash). `park` also rejects on `abortSignal` abort.
  - **Remote tool result shape:** `submitToolResult({sessionId, callId, result, isError})` where `result` is a string (the tool's output text) → resolved as `ExecuteResult { output: result, isError }`.
  - **Session lock stays in-memory this plan** (sticky-session for multi-instance interim). The Redis session-lock upgrade is a small noted follow-up (the `SessionLock` seam already exists); it is NOT required for remote tools to work, only for rejecting cross-instance concurrent prompts.
  - **Client SDK is backward compatible:** `RunOptions.tools?` is optional; existing `stream(text, {sessionId, signal})` callers (admin/web) are unaffected.
- **`ioredis` version verification:** the pub/sub API (`new Redis(url)`, `.duplicate()` for a dedicated subscriber, `.subscribe`/`.unsubscribe`/`.on("message")`, `.publish`) is stable but the task that uses it includes a step to confirm against the installed types. Add `ioredis` to the pnpm `catalog:` in `pnpm-workspace.yaml` and reference it as `catalog:` in `apps/server`.
- **Code rules (Ultracite/Biome + project):** no `any` (use `unknown`); `interface` over `type` for object shapes; `import type`; `for...of`; files ≤300 lines, functions ≤50 lines, complexity ≤10; no magic numbers (named constants); kebab-case; specific imports. `pnpm dlx ultracite fix <paths>` before each commit; lefthook blocks non-compliant commits.
- **Tests:** `pnpm -F @better-agent/<pkg> exec vitest run src/<path>.test.ts`. Typecheck per package.
- **Commits:** conventional-commits; every message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `packages/agent/src/tool/pending-store.ts` (new) — `PendingToolCallStore` interface + `createInMemoryPendingToolCallStore()` + `PENDING_TTL_MS`.
- `packages/agent/src/tool/remote-tools.ts` (new) — `buildRemoteToolDefs(defs, store)` → `ToolDef[]` whose execute parks.
- `apps/server/src/redis-pending-store.ts` (new) — `createRedisPendingToolCallStore(redis)` (ioredis pub/sub).
- `packages/env/src/server.ts` (modify) — `REDIS_URL` optional.
- `packages/api/src/services.ts` (modify) — `AgentServices.pendingToolCallStore`.
- `packages/api/src/routers/sessions.ts` (modify) — `promptInput.tools`, thread remote tools into `runTurn`, add `submitToolResult`.
- `apps/server/src/index.ts` (modify) — construct + inject the store; add `ioredis` dep.
- `packages/client/src/index.ts` (modify) — `RunOptions.tools` + local execution + `submitToolResult`.
- Tests alongside.

---

### Task 1: Env + deps for Redis

**Files:**
- Modify: `packages/env/src/server.ts`
- Modify: `pnpm-workspace.yaml` (catalog), `apps/server/package.json` (ioredis)
- Modify: `apps/server/.env` (local REDIS_URL)

- [ ] **Step 1: Add `REDIS_URL` to the env schema**

In `packages/env/src/server.ts`, inside `server: { ... }`, add:
```ts
		REDIS_URL: z.string().optional(),
```
(Optional: when unset, the server uses the in-memory pending store — single instance.)

- [ ] **Step 2: Add `ioredis` to the catalog + apps/server**

In `pnpm-workspace.yaml`'s `catalog:` block, add `ioredis: ^5.4.1` (use the current 5.x — verify the latest 5.x is fine). Then: `pnpm -F server add ioredis@catalog:`.

- [ ] **Step 3: Set local REDIS_URL**

Append to `apps/server/.env`: `REDIS_URL=redis://127.0.0.1:6379` (the user's local Redis).

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm -F @better-agent/env exec tsc --noEmit` → clean.
```bash
git add packages/env/src/server.ts pnpm-workspace.yaml apps/server/package.json pnpm-lock.yaml
git commit -m "feat(env): add REDIS_URL and ioredis dependency"
```
(`.env` is gitignored.)

---

### Task 2: PendingToolCallStore port + in-memory impl

**Files:**
- Create: `packages/agent/src/tool/pending-store.ts`
- Create: `packages/agent/src/tool/pending-store.test.ts`

**Interfaces:**
- Consumes: `ExecuteResult` (Plan A, `./types`).
- Produces:
  - `interface PendingToolCallStore { park(input: { sessionId: string; callId: string; abortSignal?: AbortSignal }): Promise<ExecuteResult>; resolve(input: { sessionId: string; callId: string; result: ExecuteResult }): Promise<void> }`
  - `createInMemoryPendingToolCallStore(): PendingToolCallStore`
  - `const PENDING_TTL_MS = 120_000`

- [ ] **Step 1: Write the failing test**

`packages/agent/src/tool/pending-store.test.ts`:
```ts
import { expect, it, vi } from "vitest";
import { createInMemoryPendingToolCallStore } from "./pending-store";

it("park resolves when resolve is called for the same call", async () => {
	const store = createInMemoryPendingToolCallStore();
	const parked = store.park({ sessionId: "s1", callId: "c1" });
	await store.resolve({ sessionId: "s1", callId: "c1", result: { output: "OK" } });
	await expect(parked).resolves.toEqual({ output: "OK" });
});

it("resolve for an unknown call is a no-op", async () => {
	const store = createInMemoryPendingToolCallStore();
	await expect(
		store.resolve({ sessionId: "s1", callId: "nope", result: { output: "x" } })
	).resolves.toBeUndefined();
});

it("park rejects on abort", async () => {
	const store = createInMemoryPendingToolCallStore();
	const ac = new AbortController();
	const parked = store.park({ sessionId: "s1", callId: "c1", abortSignal: ac.signal });
	ac.abort();
	await expect(parked).rejects.toThrow(/abort/i);
});

it("park rejects after the TTL", async () => {
	vi.useFakeTimers();
	const store = createInMemoryPendingToolCallStore();
	const parked = store.park({ sessionId: "s1", callId: "c1" });
	const assertion = expect(parked).rejects.toThrow(/timeout/i);
	await vi.advanceTimersByTimeAsync(120_001);
	await assertion;
	vi.useRealTimers();
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (no module).

- [ ] **Step 3: Implement**

`packages/agent/src/tool/pending-store.ts`:
```ts
import type { ExecuteResult } from "./types";

export const PENDING_TTL_MS = 120_000;

export interface PendingToolCallStore {
	park(input: {
		sessionId: string;
		callId: string;
		abortSignal?: AbortSignal;
	}): Promise<ExecuteResult>;
	resolve(input: {
		sessionId: string;
		callId: string;
		result: ExecuteResult;
	}): Promise<void>;
}

function keyFor(sessionId: string, callId: string): string {
	return `${sessionId}:${callId}`;
}

export function createInMemoryPendingToolCallStore(): PendingToolCallStore {
	const pending = new Map<string, (result: ExecuteResult) => void>();
	return {
		park({ sessionId, callId, abortSignal }) {
			const key = keyFor(sessionId, callId);
			return new Promise<ExecuteResult>((resolve, reject) => {
				const timer = setTimeout(() => {
					pending.delete(key);
					reject(new Error(`Tool call ${callId} timed out`));
				}, PENDING_TTL_MS);
				const settle = (result: ExecuteResult) => {
					clearTimeout(timer);
					pending.delete(key);
					resolve(result);
				};
				pending.set(key, settle);
				abortSignal?.addEventListener("abort", () => {
					clearTimeout(timer);
					pending.delete(key);
					reject(new Error(`Tool call ${callId} aborted`));
				});
			});
		},
		resolve({ sessionId, callId, result }) {
			pending.get(keyFor(sessionId, callId))?.(result);
			return Promise.resolve();
		},
	};
}
```

- [ ] **Step 4: Run to verify it passes** (4 tests) + `tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
pnpm dlx ultracite fix packages/agent/src/tool/pending-store.ts packages/agent/src/tool/pending-store.test.ts
git add packages/agent/src/tool/pending-store.ts packages/agent/src/tool/pending-store.test.ts
git commit -m "feat(agent): pending tool-call store (port + in-memory)"
```

---

### Task 3: Remote tool builder

**Files:**
- Create: `packages/agent/src/tool/remote-tools.ts`
- Create: `packages/agent/src/tool/remote-tools.test.ts`

**Interfaces:**
- Consumes: `ToolDef`/`ToolContext`/`ExecuteResult` (Plan A); `PendingToolCallStore` (Task 2).
- Produces: `interface RemoteToolDef { name: string; description: string; parameters: JsonSchema }`; `buildRemoteToolDefs(defs: RemoteToolDef[], store: PendingToolCallStore): ToolDef[]` — each returned `ToolDef.execute(args, ctx)` calls `store.park({ sessionId: ctx.sessionId, callId: ctx.callId, abortSignal: ctx.abortSignal })`.

- [ ] **Step 1: Write the failing test**

`packages/agent/src/tool/remote-tools.test.ts`:
```ts
import { expect, it } from "vitest";
import { createInMemoryPendingToolCallStore } from "./pending-store";
import { buildRemoteToolDefs } from "./remote-tools";

it("builds ToolDefs whose execute parks on the store and resolves via resolve()", async () => {
	const store = createInMemoryPendingToolCallStore();
	const [def] = buildRemoteToolDefs(
		[{ name: "search", description: "d", parameters: { type: "object" } }],
		store
	);
	expect(def?.name).toBe("search");
	const ctx = { sessionId: "s1", callId: "c1", messageId: "m1", agentId: "a1", abortSignal: new AbortController().signal };
	const running = def?.execute({ q: "x" }, ctx);
	await store.resolve({ sessionId: "s1", callId: "c1", result: { output: "FOUND" } });
	await expect(running).resolves.toEqual({ output: "FOUND" });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

`packages/agent/src/tool/remote-tools.ts`:
```ts
import type { PendingToolCallStore } from "./pending-store";
import type { JsonSchema, ToolDef } from "./types";

export interface RemoteToolDef {
	name: string;
	description: string;
	parameters: JsonSchema;
}

export function buildRemoteToolDefs(
	defs: RemoteToolDef[],
	store: PendingToolCallStore
): ToolDef[] {
	return defs.map((def) => ({
		name: def.name,
		description: def.description,
		parameters: def.parameters,
		execute: (_args, ctx) =>
			store.park({
				sessionId: ctx.sessionId,
				callId: ctx.callId,
				abortSignal: ctx.abortSignal,
			}),
	}));
}
```

- [ ] **Step 4: Run to verify it passes** + `tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
pnpm dlx ultracite fix packages/agent/src/tool/remote-tools.ts packages/agent/src/tool/remote-tools.test.ts
git add packages/agent/src/tool/remote-tools.ts packages/agent/src/tool/remote-tools.test.ts
git commit -m "feat(agent): build remote tool defs that park on the pending store"
```

---

### Task 4: Redis pub/sub pending store

**Files:**
- Create: `apps/server/src/redis-pending-store.ts`
- Create: `apps/server/src/redis-pending-store.test.ts`
- Modify: `apps/server/package.json` (add `ioredis-mock` devDep for the test, OR test against the local Redis)

**Interfaces:**
- Consumes: `PendingToolCallStore` (Task 2).
- Produces: `createRedisPendingToolCallStore(redis: Redis): PendingToolCallStore` — `park` SUBSCRIBEs a dedicated subscriber connection to `toolresult:{sessionId}:{callId}` + stores a local resolver; `resolve` PUBLISHes `JSON.stringify(result)` to that channel. The instance that parked receives the message, parses, resolves, and unsubscribes. Same TTL/abort semantics as in-memory.

- [ ] **Step 1: Verify the `ioredis` pub/sub API**

Read the installed `ioredis` types: confirm `new Redis(url)`, `redis.duplicate()` (dedicated subscriber connection — a connection in subscriber mode can't issue normal commands), `subscriber.subscribe(channel)`, `subscriber.unsubscribe(channel)`, `subscriber.on("message", (channel, message) => ...)`, and `publisher.publish(channel, payload)`. Record the exact signatures; adjust the code below if needed. Decide the test approach: prefer `ioredis-mock` (add as devDep) which supports pub/sub; if its pub/sub is unreliable, gate an integration test on a reachable `REDIS_URL` and skip otherwise.

- [ ] **Step 2: Write the failing test**

`apps/server/src/redis-pending-store.test.ts` (using `ioredis-mock` — its pub/sub delivers within the same process):
```ts
import RedisMock from "ioredis-mock";
import { expect, it } from "vitest";
import { createRedisPendingToolCallStore } from "./redis-pending-store";

it("park resolves when resolve publishes the result (cross-connection)", async () => {
	// Two separate client instances simulate two server instances sharing Redis.
	const redisA = new RedisMock();
	const redisB = new RedisMock();
	const parker = createRedisPendingToolCallStore(redisA);
	const resolver = createRedisPendingToolCallStore(redisB);
	const parked = parker.park({ sessionId: "s1", callId: "c1" });
	// allow the subscribe to register
	await new Promise((r) => setTimeout(r, 10));
	await resolver.resolve({ sessionId: "s1", callId: "c1", result: { output: "OK" } });
	await expect(parked).resolves.toEqual({ output: "OK" });
});
```
(If `ioredis-mock`'s two instances don't share a pub/sub bus, use a single shared mock or the `.createConnectedClient()` helper — adjust per what the mock supports, verified in Step 1.)

- [ ] **Step 3: Run to verify it fails** — FAIL (no module).

- [ ] **Step 4: Implement**

`apps/server/src/redis-pending-store.ts`:
```ts
import type {
	ExecuteResult,
	PendingToolCallStore,
} from "@better-agent/agent/tool/pending-store";
import { PENDING_TTL_MS } from "@better-agent/agent/tool/pending-store";
import type { Redis } from "ioredis";

function channelFor(sessionId: string, callId: string): string {
	return `toolresult:${sessionId}:${callId}`;
}

export function createRedisPendingToolCallStore(
	redis: Redis
): PendingToolCallStore {
	const subscriber = redis.duplicate();
	const local = new Map<string, (result: ExecuteResult) => void>();
	subscriber.on("message", (channel: string, payload: string) => {
		const settle = local.get(channel);
		if (settle) {
			local.delete(channel);
			subscriber.unsubscribe(channel);
			settle(JSON.parse(payload) as ExecuteResult);
		}
	});
	return {
		park({ sessionId, callId, abortSignal }) {
			const channel = channelFor(sessionId, callId);
			return new Promise<ExecuteResult>((resolve, reject) => {
				const cleanup = () => {
					local.delete(channel);
					subscriber.unsubscribe(channel);
				};
				const timer = setTimeout(() => {
					cleanup();
					reject(new Error(`Tool call ${callId} timed out`));
				}, PENDING_TTL_MS);
				local.set(channel, (result) => {
					clearTimeout(timer);
					resolve(result);
				});
				subscriber.subscribe(channel);
				abortSignal?.addEventListener("abort", () => {
					clearTimeout(timer);
					cleanup();
					reject(new Error(`Tool call ${callId} aborted`));
				});
			});
		},
		async resolve({ sessionId, callId, result }) {
			await redis.publish(channelFor(sessionId, callId), JSON.stringify(result));
		},
	};
}
```
(Note: `ExecuteResult`/`PendingToolCallStore` are re-exported from `@better-agent/agent/tool/pending-store` — confirm the export path; if `ExecuteResult` is only in `./types`, import it from `@better-agent/agent/tool/types`.)

- [ ] **Step 5: Run to verify it passes** + `pnpm -F server check-types` clean.

- [ ] **Step 6: Commit**
```bash
pnpm dlx ultracite fix apps/server/src/redis-pending-store.ts apps/server/src/redis-pending-store.test.ts
git add apps/server/src/redis-pending-store.ts apps/server/src/redis-pending-store.test.ts apps/server/package.json pnpm-lock.yaml
git commit -m "feat(server): redis pub/sub pending tool-call store"
```

---

### Task 5: API — submitToolResult + remote tools in prompt

**Files:**
- Modify: `packages/api/src/services.ts` (add `pendingToolCallStore`)
- Modify: `packages/api/src/routers/sessions.ts`
- Modify: `packages/api/src/routers/sessions.test.ts` (deps + a test)

**Interfaces:**
- Consumes: `buildRemoteToolDefs` (Task 3), `PendingToolCallStore` (Task 2).
- Produces: `AgentServices.pendingToolCallStore: PendingToolCallStore`; `promptInput` gains `tools?: Array<{ name; description; parameters }>`; `streamTurn` builds remote tools and passes them to `runTurn`; new `sessions.submitToolResult({ sessionId, callId, result, isError })` (agentProcedure, owned-session) → `store.resolve(...)`.

- [ ] **Step 1: Add the store to AgentServices**

In `packages/api/src/services.ts`, import `PendingToolCallStore` from `@better-agent/agent/tool/pending-store` and add `pendingToolCallStore: PendingToolCallStore;` to `AgentServices`.

- [ ] **Step 2: Write the failing test**

In `packages/api/src/routers/sessions.test.ts`, build the client with `pendingToolCallStore: createInMemoryPendingToolCallStore()` in the services, and add a test: call `submitToolResult` for a parked call resolves it. Minimal shape (adapt to the file's `buildClient` helper):
```ts
it("submitToolResult resolves a parked tool call", async () => {
	const store = createInMemoryPendingToolCallStore();
	// services includes pendingToolCallStore: store; client is the agent-scoped router client
	const parked = store.park({ sessionId: session.id, callId: "c1" });
	await client.sessions.submitToolResult({ sessionId: session.id, callId: "c1", result: "DONE", isError: false });
	await expect(parked).resolves.toEqual({ output: "DONE", isError: false });
});
```

- [ ] **Step 3: Run to verify it fails** — FAIL (no `submitToolResult`).

- [ ] **Step 4: Implement the router changes**

In `packages/api/src/routers/sessions.ts`:
- Extend `promptInput`:
```ts
const promptInput = z.object({
	sessionId: z.uuid(),
	text: z.string().min(1),
	tools: z
		.array(
			z.object({
				name: z.string().min(1),
				description: z.string(),
				parameters: z.record(z.string(), z.unknown()),
			})
		)
		.optional(),
});
```
- In `streamTurn`, build remote tools and pass them:
```ts
const toolDefs = input.tools
	? buildRemoteToolDefs(input.tools, context.services.pendingToolCallStore)
	: undefined;
yield* context.services.runtime.runTurn({
	sessionId: input.sessionId,
	text: input.text,
	tools: toolDefs,
	abortSignal: signal,
});
```
  (Thread `input.tools` into `streamTurn`'s `input` param; `prompt`/`run` already pass `input` through.)
- Add the procedure:
```ts
	submitToolResult: agentProcedure
		.input(
			z.object({
				sessionId: z.uuid(),
				callId: z.string().min(1),
				result: z.string(),
				isError: z.boolean().default(false),
			})
		)
		.handler(async ({ input, context }) => {
			await requireOwnedSession(context, context.authedAgent.id, input.sessionId);
			await context.services.pendingToolCallStore.resolve({
				sessionId: input.sessionId,
				callId: input.callId,
				result: { output: input.result, isError: input.isError },
			});
			return { ok: true };
		}),
```

- [ ] **Step 5: Run tests + typecheck** — `pnpm -F @better-agent/api test` PASS; `pnpm -F @better-agent/api exec tsc -b` clean. (The `run` non-streaming path also gains `tools` via the shared `promptInput`; threading is identical — wire it the same way in the `run` handler if it constructs the runTurn input.)

- [ ] **Step 6: Commit**
```bash
pnpm dlx ultracite fix packages/api/src
git add packages/api/src/services.ts packages/api/src/routers/sessions.ts packages/api/src/routers/sessions.test.ts
git commit -m "feat(api): submitToolResult endpoint and remote tools in prompt"
```

---

### Task 6: Server wiring

**Files:**
- Modify: `apps/server/src/index.ts`

**Interfaces:**
- Consumes: `createInMemoryPendingToolCallStore` (Task 2), `createRedisPendingToolCallStore` (Task 4).
- Produces: `buildServices` constructs the pending store (Redis when `env.REDIS_URL` set, else in-memory) and adds `pendingToolCallStore` to the services object.

- [ ] **Step 1: Construct + inject**

In `apps/server/src/index.ts` `buildServices`:
```ts
import Redis from "ioredis";
import { createInMemoryPendingToolCallStore } from "@better-agent/agent/tool/pending-store";
import { createRedisPendingToolCallStore } from "./redis-pending-store";
// ...
const pendingToolCallStore = env.REDIS_URL
	? createRedisPendingToolCallStore(new Redis(env.REDIS_URL))
	: createInMemoryPendingToolCallStore();
```
Add `pendingToolCallStore` to the returned `services` object. If a function exceeds 50 lines, extract a small helper (mirror `buildProviderDeps`).

- [ ] **Step 2: Typecheck + manual smoke** — `pnpm -F server check-types` clean. Manual (user-run, not automated): start the server; it connects to Redis (or logs in-memory mode). DO NOT auto-run the dev server.

- [ ] **Step 3: Commit**
```bash
pnpm dlx ultracite fix apps/server/src/index.ts
git add apps/server/src/index.ts
git commit -m "feat(server): wire pending tool-call store (redis or in-memory)"
```

---

### Task 7: Client SDK — local tool execution

**Files:**
- Modify: `packages/client/src/index.ts`
- Create/Modify: `packages/client/src/index.test.ts` (if the package has tests; else add one)

**Interfaces:**
- Produces: `interface ClientToolDef { name: string; description: string; parameters: Record<string, unknown>; execute(args: unknown): Promise<string> }`; `RunOptions` gains `tools?: ClientToolDef[]`. `stream(text, { tools })` sends the tool *definitions* (name/description/parameters) in the `prompt` call; while iterating events, on a `tool-call` event it runs the matching local tool's `execute(args)` and calls `client.sessions.submitToolResult({ sessionId, callId, result, isError })` (concurrently, not blocking event iteration); on the tool's throw it submits `{ isError: true, result: <message> }`. `run` likewise.

- [ ] **Step 1: Verify the consumer contract is preserved**

Confirm existing admin/web calls `stream(text, { sessionId, signal })` (no `tools`) keep working — `tools` is optional; when absent, no defs are sent and no local execution happens. Read `packages/client/src/index.ts` for the exact `stream`/`prompt` call to extend.

- [ ] **Step 2: Write the failing test**

Add a test (the client can be pointed at a fake oRPC client, or test the tool-dispatch helper in isolation). Minimal: a `dispatchToolCall(tools, event, submit)` helper that, given a `tool-call` event and a tool list, runs the matching tool and calls `submit` with the result; on a missing tool or a throw, submits `isError: true`. Test it directly:
```ts
it("runs the matching local tool and submits its result", async () => {
	const calls: unknown[] = [];
	await dispatchToolCall(
		[{ name: "echo", description: "", parameters: {}, execute: (a) => Promise.resolve(`r:${JSON.stringify(a)}`) }],
		{ type: "tool-call", callId: "c1", toolName: "echo", args: { v: 1 } },
		(r) => { calls.push(r); return Promise.resolve(); }
	);
	expect(calls[0]).toEqual({ callId: "c1", result: 'r:{"v":1}', isError: false });
});

it("submits isError when the tool throws or is missing", async () => {
	const calls: unknown[] = [];
	await dispatchToolCall([], { type: "tool-call", callId: "c1", toolName: "nope", args: {} }, (r) => { calls.push(r); return Promise.resolve(); });
	expect((calls[0] as { isError: boolean }).isError).toBe(true);
});
```

- [ ] **Step 3: Run to verify it fails** — FAIL.

- [ ] **Step 4: Implement**

In `packages/client/src/index.ts`:
- Add `ClientToolDef` + `RunOptions.tools?`.
- Add the exported helper `dispatchToolCall(tools, event, submit)` that finds the tool by `event.toolName`, runs `execute(event.args)`, and calls `submit({ callId: event.callId, result, isError })`; catches throws/missing → `submit({ callId, result: <message>, isError: true })`.
- In `stream`: pass `tools: options?.tools?.map(({ name, description, parameters }) => ({ name, description, parameters }))` into the `client.sessions.prompt(...)` input. While iterating events, when an event is `tool-call` and `options?.tools` is set, call `dispatchToolCall(options.tools, event, (r) => client.sessions.submitToolResult({ sessionId, callId: r.callId, result: r.result, isError: r.isError }))` — do NOT await it inside the loop in a way that deadlocks (the server stream only continues after the result is submitted; fire the dispatch concurrently and keep iterating so the subsequent `tool-result`/`text` events are consumed). Still `yield` the `tool-call` event to the caller so app UIs can show it.
- `run` (non-streaming) must also handle tools: since `run` drains internally, it needs the same dispatch — either route `run` through the same streaming+dispatch path, or document that `run` does not support remote tools this plan (prefer routing through stream + collecting the final message).

- [ ] **Step 5: Run tests + typecheck** — `pnpm -F @better-agent/client exec vitest run` PASS; `pnpm -F @better-agent/client exec tsc --noEmit` clean; `pnpm -F @better-agent/admin check-types` clean (consumer unaffected).

- [ ] **Step 6: Commit**
```bash
pnpm dlx ultracite fix packages/client/src
git add packages/client/src
git commit -m "feat(client): run remote tools locally and submit results"
```

---

## Final verification

- [ ] **Suites:** `pnpm -F @better-agent/agent test`, `pnpm -F @better-agent/api test`, `pnpm -F server test` (redis-pending-store), `pnpm -F @better-agent/client test` — green.
- [ ] **Typecheck:** agent / api / server / client / admin — clean.
- [ ] **Lint:** `pnpm dlx ultracite check packages/agent/src/tool packages/api/src packages/client/src apps/server/src` — clean.
- [ ] **End-to-end (user-run, manual — per the no-auto-browser rule):** with the dev stack + Redis up, define a client tool, send a prompt that triggers it, confirm: `tool-call` event arrives, the client runs the tool, `submitToolResult` posts back, the model continues, the turn completes; the `messages` show persisted tool-call + tool-result parts. Run two server instances pointed at the same Redis to confirm cross-instance resolution (park on A, submit hits B, A continues).
- [ ] **Coverage:** T2 → Tasks 2–7. The runtime is unchanged (remote tools flow through Plan A's `RunTurnInput.tools`). Pending store is multi-instance (Redis pub/sub) behind a port (in-memory for single-instance/tests).
- [ ] **Scope guard / follow-ups (by design):** the **session lock stays in-memory** (Redis SETNX lock is a noted follow-up for rejecting cross-instance concurrent prompts; remote tools work without it). No prompt caching/accounting (Plan C). No admin/web UI for defining tools (the SDK is the surface). `run` remote-tool support routes through the stream path or is documented as stream-only.
