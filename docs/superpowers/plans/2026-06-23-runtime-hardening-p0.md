# Runtime Hardening (P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@better-agent/agent`'s session runtime correct and robust under failure and concurrency — before the tool system (multi-step loops) lands and multiplies failure surface.

**Architecture:** Four P0 hardening items from `docs/research/agent-gap-analysis.md` §2.2/§4, all inside `packages/agent/src/session`: (R10) a pure error classifier; (R3) a per-session lock that *rejects* concurrent turns; (R5) incremental streaming persistence so a mid-stream crash keeps partial output; (R4) a runtime-owned classified retry/backoff around the model call. The runtime stays ports/DI-driven; the lock is a swappable port (in-memory now, Redis later).

**Tech Stack:** TypeScript, Vercel AI SDK v6 (`ai`, `@ai-sdk/provider`), Vitest (`ai/test` `MockLanguageModelV3`/`simulateReadableStream`), the project's fakes in `packages/agent/src/testing`.

**Source design (validated):** `docs/research/agent-gap-analysis.md` (R3/R4/R5/R10 rows; §4 priority). The four design decisions below were fixed when scoping this plan.

## Global Constraints

- **Decisions (binding):**
  - **R3** — a busy session *rejects* a concurrent turn (throws `SessionBusyError`); it does NOT queue. The lock is an injected `SessionLock` port; this plan ships the in-memory impl only.
  - **R5** — the streaming part is created on the *first* delta (status `streaming`) and updated in place; persistence is throttled to at most once per `PERSIST_THROTTLE_MS = 250` ms; finalized at stream end.
  - **R10** — `classifyError(error) → "retryable" | "content-filter" | "fatal" | "aborted"`; `MessageError` gains an optional `category` (additive, stored in the existing jsonb `error` column — **no migration**).
  - **R4** — the runtime owns retry: `streamText` is called with `maxRetries: 0`; retry fires ONLY when the error is `retryable` AND no output was emitted in the attempt (a partial stream can't be cleanly resumed); exponential backoff `BASE_BACKOFF_MS = 500` × 2^(attempt−1); `MAX_LLM_ATTEMPTS = 3`. A `sleep` dep (optional, real default) makes retry tests instant.
- **Code rules (Ultracite/Biome + project):** no `any` (use `unknown`); `interface` over `type` for object shapes; `import type` for type-only imports; `for...of` over `.forEach`; files ≤300 lines, functions ≤50 lines, complexity ≤10; no magic numbers (use the named constants above); kebab-case filenames; specific imports (no namespace imports). Run `pnpm dlx ultracite fix <paths>` before each commit; the lefthook pre-commit hook (ultracite + file-rules) blocks non-compliant commits.
- **Tests:** `pnpm -F @better-agent/agent exec vitest run src/session/<file>.test.ts`. Typecheck: `pnpm -F @better-agent/agent exec tsc --noEmit`.
- **Commits:** conventional-commits subject; every message MUST end with the footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `packages/agent/src/session/error-classify.ts` (new) — `classifyError`, the `RETRYABLE_STATUS` set, the abort/content-filter heuristics. One responsibility: turn an unknown thrown value into an `ErrorCategory`.
- `packages/agent/src/session/session-lock.ts` (new) — `SessionLock` interface, `createInMemorySessionLock()`, `SessionBusyError`.
- `packages/agent/src/session/types.ts` (modify) — add `ErrorCategory` + `category?` on `MessageError`.
- `packages/agent/src/session/runtime.ts` (modify across Tasks 1–4) — wire category into the outcome, lock into `runTurn`, incremental persistence into `createPartBuffer`, retry into `streamAssistant`.
- `packages/agent/src/ports.ts` — no change (SessionLock lives in `session/`, injected via `SessionRuntimeDeps`, mirroring how `ModelFactory` is injected).
- `apps/server/src/index.ts` (modify, Task 2) — construct and inject the in-memory lock.
- Tests: `error-classify.test.ts` (new), and additions to `runtime.test.ts`.

---

### Task 1: Error classification (R10)

**Files:**
- Modify: `packages/agent/src/session/types.ts`
- Create: `packages/agent/src/session/error-classify.ts`
- Create: `packages/agent/src/session/error-classify.test.ts`
- Modify: `packages/agent/src/session/runtime.ts`

**Interfaces:**
- Produces: `type ErrorCategory = "retryable" | "content-filter" | "fatal" | "aborted"` (in `types.ts`); `classifyError(error: unknown): ErrorCategory` (in `error-classify.ts`); `MessageError` gains `category?: ErrorCategory`. `StreamOutcome` (runtime-internal) gains `errorCategory: ErrorCategory | null`.

- [ ] **Step 1: Add the type and field**

In `packages/agent/src/session/types.ts`, add the union (place it just above `MessageError`) and extend `MessageError`:
```ts
export type ErrorCategory = "retryable" | "content-filter" | "fatal" | "aborted";

export interface MessageError {
	message: string;
	category?: ErrorCategory;
}
```

- [ ] **Step 2: Write the failing classifier test**

`packages/agent/src/session/error-classify.test.ts`:
```ts
import { expect, it } from "vitest";
import { classifyError } from "./error-classify";

it("classifies retryable HTTP statuses as retryable", () => {
	expect(classifyError({ statusCode: 429 })).toBe("retryable");
	expect(classifyError({ statusCode: 503 })).toBe("retryable");
	expect(classifyError({ statusCode: 500 })).toBe("retryable");
});

it("classifies client errors as fatal", () => {
	expect(classifyError({ statusCode: 400 })).toBe("fatal");
	expect(classifyError({ statusCode: 401 })).toBe("fatal");
	expect(classifyError(new Error("nonsense"))).toBe("fatal");
});

it("classifies network/timeout/overloaded messages as retryable", () => {
	expect(classifyError(new Error("fetch failed"))).toBe("retryable");
	expect(classifyError(new Error("request timeout"))).toBe("retryable");
	expect(classifyError(new Error("Overloaded"))).toBe("retryable");
});

it("classifies abort errors as aborted", () => {
	expect(classifyError({ name: "AbortError" })).toBe("aborted");
});

it("classifies content-filter errors as content-filter", () => {
	expect(classifyError(new Error("content filter triggered"))).toBe(
		"content-filter"
	);
});

it("honors an explicit isRetryable flag", () => {
	expect(classifyError({ isRetryable: true })).toBe("retryable");
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/error-classify.test.ts`
Expected: FAIL — cannot find module `./error-classify`.

- [ ] **Step 4: Implement the classifier**

`packages/agent/src/session/error-classify.ts`:
```ts
import type { ErrorCategory } from "./types";

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_PATTERNS = [
	"timeout",
	"timed out",
	"econnreset",
	"econnrefused",
	"network",
	"fetch failed",
	"overloaded",
	"rate limit",
];

interface MaybeApiError {
	statusCode?: unknown;
	name?: unknown;
	message?: unknown;
	isRetryable?: unknown;
}

function asError(error: unknown): MaybeApiError {
	return typeof error === "object" && error !== null
		? (error as MaybeApiError)
		: {};
}

export function classifyError(error: unknown): ErrorCategory {
	const e = asError(error);
	if (e.name === "AbortError" || e.name === "TimeoutError") {
		return "aborted";
	}
	const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
	if (message.includes("content filter") || message.includes("content_filter")) {
		return "content-filter";
	}
	if (typeof e.statusCode === "number" && RETRYABLE_STATUS.has(e.statusCode)) {
		return "retryable";
	}
	if (e.isRetryable === true) {
		return "retryable";
	}
	if (RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern))) {
		return "retryable";
	}
	return "fatal";
}
```
(Note: `TimeoutError` is treated as aborted — a hard deadline, not a transient blip to retry. Network "timeout" *messages* on `APICallError` still classify retryable via the pattern list.)

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/error-classify.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Wire the category into the runtime outcome**

In `packages/agent/src/session/runtime.ts`:

(a) Add the import (with the other `./` imports):
```ts
import { classifyError } from "./error-classify";
```
and add `ErrorCategory` to the existing `import type { ... } from "./types";` list.

(b) Extend `StreamOutcome` (currently lines 40-45) — add the field:
```ts
interface StreamOutcome {
	errorMessage: string | null;
	errorCategory: ErrorCategory | null;
	finishReason: FinishReason;
	status: StreamStatus;
	usage: MessageUsage | null;
}
```

(c) In `drainStream`, the `error` chunk branch — set the category:
```ts
} else if (chunk.type === "error") {
	state.status = "error";
	state.finishReason = "error";
	state.errorMessage = errorToMessage(chunk.error);
	state.errorCategory = classifyError(chunk.error);
}
```

(d) In `streamAssistant`, the initial `state` literal — add `errorCategory: null,`. And in its `catch` block, the non-abort branch — add the classify line:
```ts
} else {
	state.status = "error";
	state.finishReason = "error";
	state.errorMessage = errorToMessage(error);
	state.errorCategory = classifyError(error);
}
```

(e) In `finalizeAssistant`, write the category into the stored error:
```ts
const final = await deps.messageStore.updateMessage(assistantId, {
	status: outcome.status,
	usage: outcome.usage,
	finishReason: outcome.finishReason,
	error: outcome.errorMessage
		? { message: outcome.errorMessage, category: outcome.errorCategory ?? "fatal" }
		: null,
});
```

- [ ] **Step 7: Add a runtime test that an errored turn records a category**

Read `packages/agent/src/session/runtime.test.ts` first to reuse its existing setup/seed helper and `rejectingModel`. Add a test that a fatal model rejection stores `error.category === "fatal"`. Using the file's existing patterns, it should look like:
```ts
it("records an error category on a failed turn", async () => {
	// reuse the file's existing seeded-deps helper; point the model factory at
	// rejectingModel("bad request"), which has no retryable signal → fatal.
	const final = await drainTurn(rejectingModel("bad request"));
	expect(final.status).toBe("error");
	expect(final.error?.category).toBe("fatal");
});
```
Adapt `drainTurn`/seeding to the helpers already in the file. (If `rejectingModel` throws a bare `Error("bad request")`, `classifyError` returns `"fatal"` — no status code, no retry keywords.)

- [ ] **Step 8: Run the full agent suite + typecheck**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/error-classify.test.ts src/session/runtime.test.ts`
Expected: PASS (existing runtime tests unaffected — the `error` object now also carries `category`, which is additive).
Run: `pnpm -F @better-agent/agent exec tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
pnpm dlx ultracite fix packages/agent/src/session/error-classify.ts packages/agent/src/session/error-classify.test.ts packages/agent/src/session/types.ts packages/agent/src/session/runtime.ts packages/agent/src/session/runtime.test.ts
git add packages/agent/src/session/error-classify.ts packages/agent/src/session/error-classify.test.ts packages/agent/src/session/types.ts packages/agent/src/session/runtime.ts packages/agent/src/session/runtime.test.ts
git commit -m "feat(agent): classify runtime errors and record category"
```

---

### Task 2: Per-session concurrency lock (R3)

**Files:**
- Create: `packages/agent/src/session/session-lock.ts`
- Modify: `packages/agent/src/session/runtime.ts`
- Modify: `packages/agent/src/session/runtime.test.ts`
- Modify: `packages/api/src/routers/sessions.test.ts` (also constructs `SessionRuntimeDeps` at ~line 56 — will fail to typecheck without `sessionLock`)
- Modify: `apps/server/src/index.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `interface SessionLock { acquire(sessionId: string): boolean; release(sessionId: string): void }`; `createInMemorySessionLock(): SessionLock`; `class SessionBusyError extends Error`. `SessionRuntimeDeps` gains `sessionLock: SessionLock`.

- [ ] **Step 1: Write the failing lock unit test**

`packages/agent/src/session/session-lock.test.ts`:
```ts
import { expect, it } from "vitest";
import { createInMemorySessionLock } from "./session-lock";

it("grants the lock once and rejects a second holder", () => {
	const lock = createInMemorySessionLock();
	expect(lock.acquire("s1")).toBe(true);
	expect(lock.acquire("s1")).toBe(false);
});

it("does not block a different session", () => {
	const lock = createInMemorySessionLock();
	expect(lock.acquire("s1")).toBe(true);
	expect(lock.acquire("s2")).toBe(true);
});

it("allows re-acquire after release", () => {
	const lock = createInMemorySessionLock();
	lock.acquire("s1");
	lock.release("s1");
	expect(lock.acquire("s1")).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/session-lock.test.ts`
Expected: FAIL — cannot find module `./session-lock`.

- [ ] **Step 3: Implement the lock**

`packages/agent/src/session/session-lock.ts`:
```ts
export interface SessionLock {
	/** Try to take the lock for a session. Returns false if already held. */
	acquire(sessionId: string): boolean;
	release(sessionId: string): void;
}

export class SessionBusyError extends Error {
	constructor(sessionId: string) {
		super(`Session ${sessionId} is already processing a turn`);
		this.name = "SessionBusyError";
	}
}

/**
 * Single-process lock. Multi-instance deployments swap this for a Redis-backed
 * implementation behind the same interface (gap-analysis decision #1).
 */
export function createInMemorySessionLock(): SessionLock {
	const held = new Set<string>();
	return {
		acquire(sessionId) {
			if (held.has(sessionId)) {
				return false;
			}
			held.add(sessionId);
			return true;
		},
		release(sessionId) {
			held.delete(sessionId);
		},
	};
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/session-lock.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Inject the lock and gate `runTurn`**

In `packages/agent/src/session/runtime.ts`:

(a) Import the lock + error (with the other `./` imports):
```ts
import { SessionBusyError, type SessionLock } from "./session-lock";
```

(b) Add to `SessionRuntimeDeps`:
```ts
export interface SessionRuntimeDeps {
	agentStore: AgentStore;
	messageStore: MessageStore;
	modelFactory: ModelFactory;
	sessionStore: SessionStore;
	sessionLock: SessionLock;
}
```

(c) Wrap the `runTurn` body with acquire/release. Replace the current `runTurn` (lines 231-268) with:
```ts
async *runTurn({ sessionId, text, abortSignal }) {
	if (!deps.sessionLock.acquire(sessionId)) {
		throw new SessionBusyError(sessionId);
	}
	try {
		const { session, agent } = await loadContext(deps, sessionId);
		await persistUserTurn(deps.messageStore, sessionId, text);
		const assistant = await deps.messageStore.createMessage({
			sessionId,
			role: "assistant",
			status: "streaming",
			providerId: agent.providerId,
			modelId: agent.modelId,
		});
		yield { type: "message-start", messageId: assistant.id };
		const history = await deps.messageStore.listWithParts(sessionId);
		const messages = toModelMessages({
			systemPrompt: agent.systemPrompt,
			summary: session.summary,
			compactedThroughSeq: session.compactedThroughSeq,
			history,
		});
		const model = await deps.modelFactory.create(
			agent.providerId,
			agent.modelId
		);
		const outcome = yield* streamAssistant(
			deps,
			model,
			messages,
			agent.params,
			assistant.id,
			abortSignal
		);
		return yield* finalizeAssistant(
			deps,
			assistant.id,
			assistant,
			sessionId,
			outcome
		);
	} finally {
		deps.sessionLock.release(sessionId);
	}
},
```
(The `finally` releases on normal completion, error throw, AND generator `.return()`/abort.)

- [ ] **Step 6: Update existing runtime tests' deps + add a busy test**

In `packages/agent/src/session/runtime.test.ts`:
- Add the import: `import { createInMemorySessionLock } from "./session-lock";`
- The TS compiler will now flag every `SessionRuntimeDeps` construction as missing `sessionLock`. Add `sessionLock: createInMemorySessionLock()` to each (or to the shared seed helper if the file has one — prefer the shared helper).
- Add this test (adapt seeding to the file's existing helpers — it already seeds an agent + session and has a happy scripted model):
```ts
it("rejects a concurrent turn on the same session as busy", async () => {
	// Build deps with a shared lock and seed agent+session via the file's helper.
	const { runtime, session } = await seededRuntime(); // file's existing helper
	const first = runtime.runTurn({ sessionId: session.id, text: "hi" });
	await first.next(); // acquires the lock and starts streaming (lock held)
	const second = runtime.runTurn({ sessionId: session.id, text: "hi" });
	await expect(second.next()).rejects.toThrow(/already processing/i);
	// Drain the first turn to release the lock, then a fresh turn succeeds.
	while (!(await first.next()).done) {
		// drain
	}
	const third = runtime.runTurn({ sessionId: session.id, text: "hi" });
	expect((await third.next()).done).toBe(false);
});
```
If the file has no reusable `seededRuntime` helper, build deps inline using `createFakeAgentStore`/`createFakeSessionStore`/`createFakeMessageStore`/`fakeModelFactory(scriptedModel(HAPPY))` + `createInMemorySessionLock()`, seeding an agent (match the agent-input shape the file already uses) and a session.

- [ ] **Step 7: Inject the lock in the server and the api test**

In `apps/server/src/index.ts`:
- Add the import: `import { createInMemorySessionLock } from "@better-agent/agent/session/session-lock";`
- In `buildServices`, where `createSessionRuntime({ ... })` is called (around line 83), add `sessionLock: createInMemorySessionLock()` to its deps object.

In `packages/api/src/routers/sessions.test.ts`:
- Add the import: `import { createInMemorySessionLock } from "@better-agent/agent/session/session-lock";`
- In the `createSessionRuntime({ ... })` deps object (around line 56), add `sessionLock: createInMemorySessionLock()`.

- [ ] **Step 8: Run tests + typecheck (agent + api + server)**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/session-lock.test.ts src/session/runtime.test.ts`
Expected: PASS.
Run: `pnpm -F @better-agent/api test`
Expected: PASS (the sessions router tests still green with the lock injected).
Run: `pnpm -F @better-agent/agent exec tsc --noEmit && pnpm -F @better-agent/api exec tsc -b && pnpm -F server check-types`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
pnpm dlx ultracite fix packages/agent/src/session/session-lock.ts packages/agent/src/session/session-lock.test.ts packages/agent/src/session/runtime.ts packages/agent/src/session/runtime.test.ts packages/api/src/routers/sessions.test.ts apps/server/src/index.ts
git add packages/agent/src/session/session-lock.ts packages/agent/src/session/session-lock.test.ts packages/agent/src/session/runtime.ts packages/agent/src/session/runtime.test.ts packages/api/src/routers/sessions.test.ts apps/server/src/index.ts
git commit -m "feat(agent): per-session lock rejecting concurrent turns"
```

---

### Task 3: Incremental streaming persistence (R5)

**Files:**
- Modify: `packages/agent/src/session/runtime.ts`
- Modify: `packages/agent/src/session/runtime.test.ts`

**Interfaces:**
- Consumes: the `MessageStore.updatePart(id, patch)` port (already exists).
- Produces: `createPartBuffer(...)` now returns `{ append(delta: string): Promise<void>; flush(status: PartStatus): Promise<void> }` (`append` is now **async**). No new exported symbols.

- [ ] **Step 1: Add the failing test (part exists mid-stream)**

In `packages/agent/src/session/runtime.test.ts`, add a test that the text part is persisted with status `streaming` *before* the stream finishes. Using the file's fakes (the same `messageStore` instance passed into deps):
```ts
it("persists the streamed part incrementally (created before flush)", async () => {
	// Seed deps so you keep a reference to the fake messageStore + session.
	const { runtime, session, messageStore } = await seededRuntime(); // happy model
	const gen = runtime.runTurn({ sessionId: session.id, text: "hi" });
	let sawStreamingPart = false;
	let next = await gen.next();
	while (!next.done) {
		if (next.value.type === "text-delta") {
			const groups = await messageStore.listWithParts(session.id);
			const parts = groups.flatMap((g) => g.parts);
			if (parts.some((p) => p.type === "text" && p.status === "streaming")) {
				sawStreamingPart = true;
			}
		}
		next = await gen.next();
	}
	expect(sawStreamingPart).toBe(true);
	// And after completion the part is finalized.
	const finalParts = (await messageStore.listWithParts(session.id)).flatMap(
		(g) => g.parts
	);
	const textPart = finalParts.find((p) => p.type === "text");
	expect(textPart?.status).toBe("complete");
	expect((textPart?.content as { text: string }).text).toBe("Hello world");
});
```
(Adapt `seededRuntime` to return the `messageStore` reference; the happy model is `scriptedModel(HAPPY)`, which yields `"Hello"` then `" world"`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/runtime.test.ts -t "incrementally"`
Expected: FAIL — today the part is only created in `flush()`, so no `streaming`-status part exists mid-stream (`sawStreamingPart` stays false).

- [ ] **Step 3: Rewrite `createPartBuffer` for incremental persistence**

In `packages/agent/src/session/runtime.ts`, add the throttle constant near the top (next to `MAX_STEPS`):
```ts
const PERSIST_THROTTLE_MS = 250;
```
Replace `createPartBuffer` (lines 69-91) with:
```ts
/**
 * Accumulates one part's deltas and persists incrementally: the part is created
 * on the first delta (status "streaming"), updated in place at most once per
 * PERSIST_THROTTLE_MS, and finalized on flush. A mid-stream crash therefore
 * leaves the partial text durable rather than losing the whole message.
 */
function createPartBuffer(
	messageStore: MessageStore,
	messageId: string,
	type: "text" | "reasoning"
) {
	let buf = "";
	let partId: string | null = null;
	let lastWrite = 0;
	return {
		async append(delta: string): Promise<void> {
			buf += delta;
			if (partId === null) {
				const part = await messageStore.appendPart({
					messageId,
					type,
					content: { text: buf },
					status: "streaming",
				});
				partId = part.id;
				lastWrite = Date.now();
				return;
			}
			if (Date.now() - lastWrite >= PERSIST_THROTTLE_MS) {
				await messageStore.updatePart(partId, { content: { text: buf } });
				lastWrite = Date.now();
			}
		},
		async flush(status: PartStatus): Promise<void> {
			if (buf.length === 0) {
				return;
			}
			if (partId === null) {
				await messageStore.appendPart({
					messageId,
					type,
					content: { text: buf },
					status,
				});
				return;
			}
			await messageStore.updatePart(partId, {
				content: { text: buf },
				status,
			});
		},
	};
}
```

- [ ] **Step 4: Await the now-async `append` in `drainStream`**

In `drainStream` (lines 134-153), the two delta branches must `await`:
```ts
if (chunk.type === "text-delta") {
	await textBuf.append(chunk.text);
	yield { type: "text-delta", delta: chunk.text };
} else if (chunk.type === "reasoning-delta") {
	await reasoningBuf.append(chunk.text);
	yield { type: "reasoning-delta", delta: chunk.text };
}
```

- [ ] **Step 5: Run the new test + full runtime suite + typecheck**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/runtime.test.ts`
Expected: PASS — the new incremental test passes, and existing tests still pass (final text + `complete` status unchanged; still exactly one text part per message, now created-then-updated rather than created-at-flush).
Run: `pnpm -F @better-agent/agent exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
pnpm dlx ultracite fix packages/agent/src/session/runtime.ts packages/agent/src/session/runtime.test.ts
git add packages/agent/src/session/runtime.ts packages/agent/src/session/runtime.test.ts
git commit -m "feat(agent): persist streamed parts incrementally"
```

---

### Task 4: Classified retry/backoff around the model call (R4)

**Files:**
- Modify: `packages/agent/src/session/runtime.ts`
- Modify: `packages/agent/src/session/runtime.test.ts`

**Interfaces:**
- Consumes: `classifyError` (Task 1); `StreamOutcome.errorCategory` (Task 1).
- Produces: `SessionRuntimeDeps` gains optional `sleep?: (ms: number) => Promise<void>` (default real). `StreamOutcome` gains `emittedOutput: boolean`. No new exported symbols.

- [ ] **Step 1: Add the failing retry tests**

In `packages/agent/src/session/runtime.test.ts`, add (using `MockLanguageModelV3` + `simulateReadableStream` already imported, and `HAPPY`):
```ts
it("retries a retryable model failure then succeeds", async () => {
	let calls = 0;
	const model = new MockLanguageModelV3({
		doStream: () => {
			calls++;
			if (calls < 3) {
				return Promise.reject(
					Object.assign(new Error("overloaded"), { statusCode: 503 })
				);
			}
			return Promise.resolve({
				stream: simulateReadableStream({ chunks: HAPPY }),
			});
		},
	});
	// Seed deps with this model and an instant sleep so backoff doesn't wait.
	const final = await drainTurn(model, { sleep: () => Promise.resolve() });
	expect(calls).toBe(3);
	expect(final.status).toBe("complete");
});

it("does not retry a fatal model failure", async () => {
	let calls = 0;
	const model = new MockLanguageModelV3({
		doStream: () => {
			calls++;
			return Promise.reject(
				Object.assign(new Error("bad request"), { statusCode: 400 })
			);
		},
	});
	const final = await drainTurn(model, { sleep: () => Promise.resolve() });
	expect(calls).toBe(1);
	expect(final.status).toBe("error");
	expect(final.error?.category).toBe("fatal");
});
```
Provide/extend the file's `drainTurn(model, depsOverrides?)` helper so it builds deps (seeded agent+session, `createInMemorySessionLock()`, the given `model` via `fakeModelFactory`, and merges `depsOverrides` such as `sleep`), runs `runTurn`, drains it, and returns the final `Message`. Match the file's existing seeding shape.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/runtime.test.ts -t "retr"`
Expected: FAIL — today there is no retry loop, so the retryable case ends with `calls === 1` and `status === "error"`.

- [ ] **Step 3: Add the sleep dep + retry constants**

In `packages/agent/src/session/runtime.ts`:

(a) Add constants near `MAX_STEPS`:
```ts
const MAX_LLM_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
```

(b) Add the default sleep + helpers (place above `streamAssistant`):
```ts
function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function backoffMs(attempt: number): number {
	return BASE_BACKOFF_MS * 2 ** (attempt - 1);
}

function resetOutcome(state: StreamOutcome): void {
	state.usage = null;
	state.finishReason = "stop";
	state.status = "complete";
	state.errorMessage = null;
	state.errorCategory = null;
	state.emittedOutput = false;
}

function shouldRetryAttempt(
	state: StreamOutcome,
	attempt: number,
	aborted: boolean
): boolean {
	return (
		state.status === "error" &&
		!state.emittedOutput &&
		state.errorCategory === "retryable" &&
		attempt < MAX_LLM_ATTEMPTS &&
		!aborted
	);
}
```

(c) Add `sleep?: (ms: number) => Promise<void>;` to `SessionRuntimeDeps`.

(d) Add `emittedOutput: boolean;` to the `StreamOutcome` interface.

- [ ] **Step 4: Mark output as emitted in `drainStream`**

In `drainStream`, set the flag on each delta (so retry knows output already streamed):
```ts
if (chunk.type === "text-delta") {
	state.emittedOutput = true;
	await textBuf.append(chunk.text);
	yield { type: "text-delta", delta: chunk.text };
} else if (chunk.type === "reasoning-delta") {
	state.emittedOutput = true;
	await reasoningBuf.append(chunk.text);
	yield { type: "reasoning-delta", delta: chunk.text };
}
```

- [ ] **Step 5: Wrap the model call in the retry loop**

Replace `streamAssistant` (lines 156-201) with:
```ts
async function* streamAssistant(
	deps: SessionRuntimeDeps,
	model: AiModel,
	messages: ModelMessage[],
	params: AgentParams | null,
	assistantId: string,
	abortSignal?: AbortSignal
): AsyncGenerator<RunEvent, StreamOutcome> {
	const textBuf = createPartBuffer(deps.messageStore, assistantId, "text");
	const reasoningBuf = createPartBuffer(
		deps.messageStore,
		assistantId,
		"reasoning"
	);
	const sleep = deps.sleep ?? defaultSleep;
	const state: StreamOutcome = {
		usage: null,
		finishReason: "stop",
		status: "complete",
		errorMessage: null,
		errorCategory: null,
		emittedOutput: false,
	};
	for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
		resetOutcome(state);
		try {
			const result = streamText({
				model,
				messages,
				stopWhen: stepCountIs(MAX_STEPS),
				tools: {},
				abortSignal,
				maxRetries: 0,
				...buildSettings(params),
			});
			yield* drainStream(result, textBuf, reasoningBuf, state);
		} catch (error) {
			if (abortSignal?.aborted) {
				state.status = "aborted";
			} else {
				state.status = "error";
				state.finishReason = "error";
				state.errorMessage = errorToMessage(error);
				state.errorCategory = classifyError(error);
			}
		}
		if (shouldRetryAttempt(state, attempt, abortSignal?.aborted ?? false)) {
			await sleep(backoffMs(attempt));
			continue;
		}
		break;
	}
	const partStatus: PartStatus =
		state.status === "error" ? "error" : "complete";
	await reasoningBuf.flush(partStatus);
	await textBuf.flush(partStatus);
	return state;
}
```
(Retry only fires when `shouldRetryAttempt` is true — i.e. retryable AND nothing was emitted/persisted this attempt — so a retry never duplicates streamed deltas or partial parts. `maxRetries: 0` hands the AI SDK's own retry budget to us.)

- [ ] **Step 6: Run the retry tests + full agent suite + typecheck**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/runtime.test.ts`
Expected: PASS — retryable case `calls === 3` + `complete`; fatal case `calls === 1` + `error`/`fatal`; all prior tests still green (happy path: one attempt, no sleep).
Run: `pnpm -F @better-agent/agent exec tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
pnpm dlx ultracite fix packages/agent/src/session/runtime.ts packages/agent/src/session/runtime.test.ts
git add packages/agent/src/session/runtime.ts packages/agent/src/session/runtime.test.ts
git commit -m "feat(agent): classified retry/backoff for transient model errors"
```

---

## Final verification

- [ ] **Agent suite:** `pnpm -F @better-agent/agent test` — all green (new: error-classify, session-lock, runtime additions).
- [ ] **Typecheck:** `pnpm -F @better-agent/agent exec tsc --noEmit` and `pnpm -F server check-types` — clean.
- [ ] **Lint:** `pnpm dlx ultracite check packages/agent/src/session apps/server/src` — clean.
- [ ] **Coverage of the four items:** R10 → Task 1 (classifier + stored category); R3 → Task 2 (lock rejects concurrent turn, injected in server); R5 → Task 3 (part created on first delta, throttled updates, finalized); R4 → Task 4 (maxRetries:0 + retryable-and-no-output retry with backoff).
- [ ] **Scope guard (not in this plan, by design):** R1 compaction / R2 token-estimation are the *next* plan; the tool system (T1/T2/T4) and prompt-caching (T3) follow after. No schema migration was introduced (the `error` jsonb column absorbs `category`).
