# Long-Session Support — Token Estimation + Compaction (R2 + R1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep long conversations within the model's context window: estimate the token size of a turn and, when it would overflow, summarize older messages into the session summary so the turn fits.

**Architecture:** Two P0 items from `docs/research/agent-gap-analysis.md` §2.2 (R2 token estimation, R1 compaction), all in `packages/agent/src/session`. A pure `estimateTokens` (char/4 heuristic) + threshold check; a `compactSession` orchestration that keeps the most recent K messages verbatim and summarizes the rest via an injected `Summarizer` port; and runtime wiring that compacts before streaming. The summary write path slots into the EXISTING `toModelMessages`, which already prepends the summary and filters `seq > compactedThroughSeq` — no consumer change needed.

**Tech Stack:** TypeScript, Vercel AI SDK v6 (`generateText` for the non-streaming summary call), Vitest with the project fakes.

**Source design (validated + decided this session):** `docs/research/agent-gap-analysis.md` (R1/R2 rows; appendix references opencode `token.ts` `len/4`, `compaction.ts`).

## Global Constraints

- **Decisions (binding):**
  - **Token estimation** — char-count/4 heuristic (`CHARS_PER_TOKEN = 4`), plus `MESSAGE_OVERHEAD_TOKENS = 4` per message for role framing. No tokenizer dependency.
  - **Overflow trigger** — compact when `contextLimit != null && estimatedTokens > contextLimit × COMPACT_THRESHOLD` (`COMPACT_THRESHOLD = 0.8`). If `contextLimit` is null, NEVER compact.
  - **Strategy** — keep the most recent `KEEP_RECENT_MESSAGES = 6` messages verbatim; summarize messages with `prevCompactedSeq < seq ≤ boundary`, folding in the prior summary, and `setSummary(summary, boundary)`. This reuses the existing `toModelMessages` consumption (summary prepended, `seq > compactedThroughSeq` kept).
  - **Summarizer model** — the agent's OWN provider/model (no new config field, no migration), via a `Summarizer` port whose real impl calls AI SDK `generateText`.
  - **Ordering** — compaction runs BEFORE the assistant message is created, so a summarizer failure propagates cleanly (no orphaned `streaming` assistant message). The `run`/`prompt` api handlers already convert a thrown error into a terminal error event.
  - **No silent over-budget loop** — compact at most once per turn. If a turn still exceeds the limit after one compaction (or has ≤ `KEEP_RECENT_MESSAGES` messages so nothing can be summarized), proceed anyway; the provider error surfaces through the existing classified-error path.
- **Code rules (Ultracite/Biome + project):** no `any` (use `unknown`); `interface` over `type` for object shapes; `import type` for type-only imports; `for...of` over `.forEach`; files ≤300 lines, functions ≤50 lines, complexity ≤10; no magic numbers (use the named constants above); kebab-case filenames; specific imports. Run `pnpm dlx ultracite fix <paths>` before each commit; lefthook pre-commit (ultracite + file-rules) blocks non-compliant commits.
- **Tests:** `pnpm -F @better-agent/agent exec vitest run src/session/<file>.test.ts`. Typecheck: `pnpm -F @better-agent/agent exec tsc --noEmit`.
- **Commits:** conventional-commits subject; every message MUST end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `packages/agent/src/session/token-estimate.ts` (new) — `estimateTokens`, `exceedsContext`, the heuristic constants.
- `packages/agent/src/session/compaction.ts` (new) — `Summarizer` interface, `selectCompactionBoundary`, `buildSummaryPrompt`, `compactSession`.
- `packages/agent/src/session/model-summarizer.ts` (new) — `createModelSummarizer(modelFactory)`: the real `Summarizer` via `generateText`.
- `packages/agent/src/testing/fakes.ts` (modify) — add `createFakeSummarizer`.
- `packages/agent/src/session/runtime.ts` (modify, Task 3) — inject `modelCacheStore` + `summarizer`; compact before creating the assistant message.
- Wiring sites for the two new deps (Task 3): `runtime.test.ts`, `packages/api/src/routers/sessions.test.ts`, `apps/server/src/index.ts`.
- Tests: `token-estimate.test.ts`, `compaction.test.ts` (new); additions to `runtime.test.ts`.

---

### Task 1: Token estimation + overflow check (R2)

**Files:**
- Create: `packages/agent/src/session/token-estimate.ts`
- Create: `packages/agent/src/session/token-estimate.test.ts`

**Interfaces:**
- Produces: `estimateTokens(messages: ModelMessage[]): number`; `exceedsContext(estimatedTokens: number, contextLimit: number | null): boolean`; exported const `COMPACT_THRESHOLD = 0.8`.

- [ ] **Step 1: Write the failing test**

`packages/agent/src/session/token-estimate.test.ts`:
```ts
import type { ModelMessage } from "ai";
import { expect, it } from "vitest";
import { estimateTokens, exceedsContext } from "./token-estimate";

function msg(content: string): ModelMessage {
	return { role: "user", content };
}

it("estimates roughly chars/4 plus per-message overhead", () => {
	// 8 chars / 4 = 2, + 4 overhead = 6
	expect(estimateTokens([msg("abcdefgh")])).toBe(6);
});

it("sums across messages", () => {
	// (4/4 + 4) + (4/4 + 4) = 5 + 5 = 10
	expect(estimateTokens([msg("aaaa"), msg("bbbb")])).toBe(10);
});

it("handles non-string content by serializing it", () => {
	const m = { role: "assistant", content: [{ type: "text", text: "hi" }] } as ModelMessage;
	expect(estimateTokens([m])).toBeGreaterThan(0);
});

it("exceedsContext is true only above the threshold and with a known limit", () => {
	expect(exceedsContext(81, 100)).toBe(true); // > 100 * 0.8
	expect(exceedsContext(80, 100)).toBe(false); // == threshold, not over
	expect(exceedsContext(99_999, null)).toBe(false); // unknown limit → never
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/token-estimate.test.ts`
Expected: FAIL — cannot find module `./token-estimate`.

- [ ] **Step 3: Implement**

`packages/agent/src/session/token-estimate.ts`:
```ts
import type { ModelMessage } from "ai";

const CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 4;
export const COMPACT_THRESHOLD = 0.8;

function contentLength(content: ModelMessage["content"]): number {
	if (typeof content === "string") {
		return content.length;
	}
	return JSON.stringify(content).length;
}

export function estimateTokens(messages: ModelMessage[]): number {
	let total = 0;
	for (const message of messages) {
		total +=
			Math.ceil(contentLength(message.content) / CHARS_PER_TOKEN) +
			MESSAGE_OVERHEAD_TOKENS;
	}
	return total;
}

export function exceedsContext(
	estimatedTokens: number,
	contextLimit: number | null
): boolean {
	if (contextLimit === null) {
		return false;
	}
	return estimatedTokens > contextLimit * COMPACT_THRESHOLD;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/token-estimate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
pnpm dlx ultracite fix packages/agent/src/session/token-estimate.ts packages/agent/src/session/token-estimate.test.ts
git add packages/agent/src/session/token-estimate.ts packages/agent/src/session/token-estimate.test.ts
git commit -m "feat(agent): token estimation and context-overflow check"
```

---

### Task 2: Compaction core + Summarizer port (R1)

**Files:**
- Create: `packages/agent/src/session/compaction.ts`
- Create: `packages/agent/src/session/compaction.test.ts`
- Modify: `packages/agent/src/testing/fakes.ts` (add `createFakeSummarizer`)

**Interfaces:**
- Consumes: `SessionStore.setSummary` (exists); `MessageWithParts`, `Session`, `AgentConfig`.
- Produces:
  - `interface Summarizer { summarize(input: { providerId: string; modelId: string; prompt: string }): Promise<string> }`
  - `selectCompactionBoundary(history: MessageWithParts[], keepRecent: number): number | null`
  - `buildSummaryPrompt(priorSummary: string | null, toSummarize: MessageWithParts[]): string`
  - `compactSession(deps: { summarizer: Summarizer; sessionStore: SessionStore }, input: { sessionId: string; agent: AgentConfig; session: Session; history: MessageWithParts[] }): Promise<{ summary: string; boundary: number } | null>` — returns null when nothing was compacted.
  - exported const `KEEP_RECENT_MESSAGES = 6`.
  - `createFakeSummarizer(canned?: string): Summarizer & { calls: { providerId: string; modelId: string; prompt: string }[] }` (in fakes.ts).

- [ ] **Step 1: Write the failing test**

`packages/agent/src/session/compaction.test.ts`:
```ts
import { expect, it } from "vitest";
import { createFakeSummarizer } from "../testing/fakes";
import { compactSession, selectCompactionBoundary } from "./compaction";
import type { AgentConfig } from "../agent/types";
import type { MessageWithParts, Session } from "./types";

function entry(seq: number, role: "user" | "assistant", text: string): MessageWithParts {
	const now = new Date();
	return {
		message: {
			id: `m${seq}`, sessionId: "s1", role, seq, status: "complete",
			providerId: null, modelId: null, usage: null, finishReason: null,
			error: null, createdAt: now, updatedAt: now,
		},
		parts: [
			{
				id: `p${seq}`, messageId: `m${seq}`, seq: 0, type: "text",
				content: { text }, status: "complete", createdAt: now, updatedAt: now,
			},
		],
	};
}

const AGENT = { id: "a1", providerId: "openai", modelId: "gpt-x" } as AgentConfig;
const SESSION = { id: "s1", summary: null, compactedThroughSeq: null } as Session;

it("selectCompactionBoundary keeps the last K and returns the boundary seq", () => {
	const history = [0, 1, 2, 3].map((n) => entry(n, "user", "x"));
	// keepRecent 2 → keep seq 2,3 → boundary is seq 1
	expect(selectCompactionBoundary(history, 2)).toBe(1);
});

it("selectCompactionBoundary returns null when there is nothing to compact", () => {
	const history = [0, 1].map((n) => entry(n, "user", "x"));
	expect(selectCompactionBoundary(history, 2)).toBeNull();
});

it("compactSession summarizes older messages and persists summary + boundary", async () => {
	const summarizer = createFakeSummarizer("SUMMARY");
	const calls: { boundary: number; summary: string }[] = [];
	const sessionStore = {
		setSummary: (_id: string, summary: string, boundary: number) => {
			calls.push({ summary, boundary });
			return Promise.resolve();
		},
	} as never;
	const history = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => entry(n, "user", `m${n}`));
	const result = await compactSession(
		{ summarizer, sessionStore },
		{ sessionId: "s1", agent: AGENT, session: SESSION, history }
	);
	// KEEP_RECENT_MESSAGES=6 → keep seq 2..7 → boundary 1
	expect(result).toEqual({ summary: "SUMMARY", boundary: 1 });
	expect(calls).toEqual([{ summary: "SUMMARY", boundary: 1 }]);
	expect(summarizer.calls[0]?.providerId).toBe("openai");
	expect(summarizer.calls[0]?.prompt).toContain("m0");
});

it("compactSession returns null (no summarizer call) when history is short", async () => {
	const summarizer = createFakeSummarizer("SUMMARY");
	const sessionStore = { setSummary: () => Promise.resolve() } as never;
	const history = [0, 1].map((n) => entry(n, "user", "x"));
	const result = await compactSession(
		{ summarizer, sessionStore },
		{ sessionId: "s1", agent: AGENT, session: SESSION, history }
	);
	expect(result).toBeNull();
	expect(summarizer.calls).toHaveLength(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/compaction.test.ts`
Expected: FAIL — cannot find `./compaction` / `createFakeSummarizer`.

- [ ] **Step 3: Add the fake summarizer**

In `packages/agent/src/testing/fakes.ts`, add the import `import type { Summarizer } from "../session/compaction";` (with the other type imports) and append:
```ts
export function createFakeSummarizer(
	canned = "summary"
): Summarizer & { calls: { providerId: string; modelId: string; prompt: string }[] } {
	const calls: { providerId: string; modelId: string; prompt: string }[] = [];
	return {
		calls,
		summarize(input) {
			calls.push(input);
			return Promise.resolve(canned);
		},
	};
}
```

- [ ] **Step 4: Implement the compaction core**

`packages/agent/src/session/compaction.ts`:
```ts
import type { AgentConfig } from "../agent/types";
import type { SessionStore } from "../ports";
import type { MessageWithParts, Session } from "./types";

export const KEEP_RECENT_MESSAGES = 6;
const NO_COMPACTION = -1;

export interface Summarizer {
	summarize(input: {
		providerId: string;
		modelId: string;
		prompt: string;
	}): Promise<string>;
}

/** Seq of the last message to summarize (everything ≤ it is summarized, > it kept). */
export function selectCompactionBoundary(
	history: MessageWithParts[],
	keepRecent: number
): number | null {
	if (history.length <= keepRecent) {
		return null;
	}
	return history[history.length - keepRecent - 1]?.message.seq ?? null;
}

function renderMessage(entry: MessageWithParts): string {
	const text = entry.parts
		.filter((part) => part.type === "text" || part.type === "reasoning")
		.map((part) => (part.content as { text: string }).text)
		.join("\n");
	return `${entry.message.role}: ${text}`;
}

export function buildSummaryPrompt(
	priorSummary: string | null,
	toSummarize: MessageWithParts[]
): string {
	const lines: string[] = [];
	if (priorSummary !== null) {
		lines.push(`Summary so far:\n${priorSummary}`, "");
	}
	lines.push("Conversation to fold into the summary:");
	for (const entry of toSummarize) {
		lines.push(renderMessage(entry));
	}
	return lines.join("\n");
}

export async function compactSession(
	deps: { summarizer: Summarizer; sessionStore: SessionStore },
	input: {
		sessionId: string;
		agent: AgentConfig;
		session: Session;
		history: MessageWithParts[];
	}
): Promise<{ summary: string; boundary: number } | null> {
	const boundary = selectCompactionBoundary(input.history, KEEP_RECENT_MESSAGES);
	if (boundary === null) {
		return null;
	}
	const prevCompacted = input.session.compactedThroughSeq ?? NO_COMPACTION;
	const toSummarize = input.history.filter(
		(entry) =>
			entry.message.seq > prevCompacted && entry.message.seq <= boundary
	);
	if (toSummarize.length === 0) {
		return null;
	}
	const prompt = buildSummaryPrompt(input.session.summary, toSummarize);
	const summary = await deps.summarizer.summarize({
		providerId: input.agent.providerId,
		modelId: input.agent.modelId,
		prompt,
	});
	await deps.sessionStore.setSummary(input.sessionId, summary, boundary);
	return { summary, boundary };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/compaction.test.ts`
Expected: PASS (4 tests).
Run: `pnpm -F @better-agent/agent exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
pnpm dlx ultracite fix packages/agent/src/session/compaction.ts packages/agent/src/session/compaction.test.ts packages/agent/src/testing/fakes.ts
git add packages/agent/src/session/compaction.ts packages/agent/src/session/compaction.test.ts packages/agent/src/testing/fakes.ts
git commit -m "feat(agent): session compaction core with summarizer port"
```

---

### Task 3: Real summarizer + wire compaction into the runtime (R1 integration)

**Files:**
- Create: `packages/agent/src/session/model-summarizer.ts`
- Modify: `packages/agent/src/session/runtime.ts`
- Modify: `packages/agent/src/session/runtime.test.ts`
- Modify: `packages/api/src/routers/sessions.test.ts`
- Modify: `apps/server/src/index.ts`

**Interfaces:**
- Consumes: `estimateTokens`/`exceedsContext` (Task 1); `compactSession`/`Summarizer` (Task 2); `ModelCacheStore` (ports); `ModelFactory`.
- Produces: `createModelSummarizer(modelFactory: ModelFactory): Summarizer`. `SessionRuntimeDeps` gains `modelCacheStore: ModelCacheStore` and `summarizer: Summarizer`.

- [ ] **Step 1: Implement the real summarizer**

`packages/agent/src/session/model-summarizer.ts`:
```ts
import { generateText } from "ai";
import type { ModelFactory } from "../provider/model-factory";
import type { Summarizer } from "./compaction";

const COMPACTION_SYSTEM =
	"You are compacting a long conversation so it can continue within the model's context window. Produce a concise summary that preserves all facts, decisions, code, names, and open questions needed to continue. Output only the summary.";

export function createModelSummarizer(modelFactory: ModelFactory): Summarizer {
	return {
		async summarize({ providerId, modelId, prompt }) {
			const model = await modelFactory.create(providerId, modelId);
			const result = await generateText({
				model,
				system: COMPACTION_SYSTEM,
				prompt,
			});
			return result.text;
		},
	};
}
```

- [ ] **Step 2: Write the failing runtime integration test**

In `packages/agent/src/session/runtime.test.ts`, add a test that an over-limit history triggers compaction (using a fake summarizer + a model entry with a tiny `contextLimit`). READ the file first to reuse its seed helper; you must seed a `modelCacheStore` entry and inject a fake summarizer. Shape:
```ts
it("compacts the session before streaming when the context would overflow", async () => {
	// Build deps with: a fake summarizer (createFakeSummarizer("RECAP")), and a
	// modelCacheStore seeded with { providerId, modelId, contextLimit: 50, ... }.
	// Seed the session with several prior messages whose text estimates > 50*0.8.
	const { runtime, session, summarizer, sessionStore } = await overflowSetup();
	await drainTurn2(runtime.runTurn({ sessionId: session.id, text: "next" }));
	// The summarizer was called and the session summary was written.
	expect(summarizer.calls.length).toBe(1);
	const updated = await sessionStore.get(session.id);
	expect(updated?.summary).toBe("RECAP");
	expect(updated?.compactedThroughSeq).not.toBeNull();
});
```
Provide `overflowSetup`/`drainTurn2` consistent with the file's existing helpers: construct `SessionRuntimeDeps` with all required fields (now including `modelCacheStore` and `summarizer`), seed an agent + session + enough prior messages (via `messageStore.createMessage`/`appendPart`) to exceed the tiny limit, and a happy scripted model for the actual turn.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/runtime.test.ts -t "compacts"`
Expected: FAIL — `SessionRuntimeDeps` has no `modelCacheStore`/`summarizer`, and the runtime does not compact.

- [ ] **Step 4: Add the deps and wire compaction into `runTurn`**

In `packages/agent/src/session/runtime.ts`:

(a) Imports (with the other `./` imports):
```ts
import { compactSession } from "./compaction";
import type { Summarizer } from "./compaction";
import { estimateTokens, exceedsContext } from "./token-estimate";
```
and add `ModelCacheStore` to the `../ports` import.

(b) Extend `SessionRuntimeDeps`:
```ts
	modelCacheStore: ModelCacheStore;
	summarizer: Summarizer;
```

(c) Add a helper above `createSessionRuntime` that compacts when needed and returns the messages to send:
```ts
async function buildTurnMessages(
	deps: SessionRuntimeDeps,
	agent: AgentConfig,
	session: Session,
	sessionId: string
): Promise<ModelMessage[]> {
	const history = await deps.messageStore.listWithParts(sessionId);
	const base = {
		systemPrompt: agent.systemPrompt,
		summary: session.summary,
		compactedThroughSeq: session.compactedThroughSeq,
		history,
	};
	const messages = toModelMessages(base);
	const modelEntry = await deps.modelCacheStore.get(
		agent.providerId,
		agent.modelId
	);
	const limit = modelEntry?.contextLimit ?? null;
	if (!exceedsContext(estimateTokens(messages), limit)) {
		return messages;
	}
	const compacted = await compactSession(
		{ summarizer: deps.summarizer, sessionStore: deps.sessionStore },
		{ sessionId, agent, session, history }
	);
	if (compacted === null) {
		return messages;
	}
	return toModelMessages({
		...base,
		summary: compacted.summary,
		compactedThroughSeq: compacted.boundary,
	});
}
```

(d) In `runTurn`, REORDER so messages (incl. compaction) are built BEFORE the assistant message is created. Replace the current body (loadContext → persistUserTurn → createMessage(assistant) → message-start → listWithParts → toModelMessages → streamAssistant) with:
```ts
const { session, agent } = await loadContext(deps, sessionId);
await persistUserTurn(deps.messageStore, sessionId, text);
const messages = await buildTurnMessages(deps, agent, session, sessionId);
const assistant = await deps.messageStore.createMessage({
	sessionId,
	role: "assistant",
	status: "streaming",
	providerId: agent.providerId,
	modelId: agent.modelId,
});
yield { type: "message-start", messageId: assistant.id };
const model = await deps.modelFactory.create(agent.providerId, agent.modelId);
const outcome = yield* streamAssistant(
	deps,
	model,
	messages,
	agent.params,
	assistant.id,
	abortSignal
);
return yield* finalizeAssistant(deps, assistant.id, assistant, sessionId, outcome);
```
(Keep the surrounding `if (!deps.sessionLock.acquire(...)) throw ...` / `try` / `finally release` wrapper unchanged. A summarizer failure now throws before the assistant message exists → no orphan streaming message; the api handler converts it to an error event.)

- [ ] **Step 5: Update the other three deps sites**

- `packages/agent/src/session/runtime.test.ts`: every `SessionRuntimeDeps` construction (or the shared seed helper) gains `modelCacheStore: createFakeModelStore()` and `summarizer: createFakeSummarizer()` (import both from `../testing/fakes`).
- `packages/api/src/routers/sessions.test.ts`: the `createSessionRuntime({ ... })` deps gains `modelCacheStore: createFakeModelStore()` and `summarizer: createFakeSummarizer()` (import from `@better-agent/agent/testing/fakes`).
- `apps/server/src/index.ts`: import `createModelSummarizer` from `@better-agent/agent/session/model-summarizer`; in `buildServices`, the `createSessionRuntime({ ... })` deps gains `modelCacheStore: modelCache` (the existing model-cache store local) and `summarizer: createModelSummarizer(modelFactory)`. If this pushes a function over 50 lines, extract a small helper (mirror the existing `buildProviderDeps` pattern) and report it.

- [ ] **Step 6: Run tests + typecheck (agent + api + server)**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/runtime.test.ts`
Expected: PASS — the new compaction test plus all existing (a normal turn whose estimate is under a large/`null` limit does NOT compact, so the summarizer is untouched and prior tests are unaffected).
Run: `pnpm -F @better-agent/api test`
Expected: PASS.
Run: `pnpm -F @better-agent/agent exec tsc --noEmit && pnpm -F @better-agent/api exec tsc -b && pnpm -F server check-types`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
pnpm dlx ultracite fix packages/agent/src/session/model-summarizer.ts packages/agent/src/session/runtime.ts packages/agent/src/session/runtime.test.ts packages/api/src/routers/sessions.test.ts apps/server/src/index.ts
git add packages/agent/src/session/model-summarizer.ts packages/agent/src/session/runtime.ts packages/agent/src/session/runtime.test.ts packages/api/src/routers/sessions.test.ts apps/server/src/index.ts
git commit -m "feat(agent): compact overflowing sessions before streaming"
```

---

## Final verification

- [ ] **Agent suite:** `pnpm -F @better-agent/agent test` — all green (new: token-estimate, compaction, runtime compaction test).
- [ ] **Typecheck:** `pnpm -F @better-agent/agent exec tsc --noEmit`, `pnpm -F @better-agent/api exec tsc -b`, `pnpm -F server check-types` — clean.
- [ ] **Lint:** `pnpm dlx ultracite check packages/agent/src/session apps/server/src` — clean.
- [ ] **Coverage:** R2 → Task 1 (estimate + threshold); R1 → Task 2 (boundary/summarize/persist) + Task 3 (real summarizer + runtime wiring). The existing `toModelMessages` consumes the written summary unchanged.
- [ ] **Scope guard (by design):** summarizer is the agent's own model (no new config/migration); compaction is single-pass (no over-budget loop); no client-facing "compacted" event (YAGNI). Next plans: the tool system (T1/T2/T4) + prompt caching (T3).
