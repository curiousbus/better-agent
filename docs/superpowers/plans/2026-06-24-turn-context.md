# Turn Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject the current date into the system prompt every turn (R11) and auto-generate a chat title from the first user message (R8).

**Architecture:** R11 is a pure `buildDynamicContext(now)` appended to `agent.systemPrompt` in `buildTurnMessages`, with an injectable `clock`. R8 adds an optional `Titler` dep; `executeTurn` fires title generation in parallel with the LLM stream (based on the user text), `await`s it before returning, calls `setTitle`, and emits a `title` event. Both are zero-migration (`session.title` column exists).

**Tech Stack:** TypeScript, AI SDK v6 (`generateText`), vitest + `ai/test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-24-turn-context-design.md`. Every task implicitly includes its decisions.
- Zero DB migration. Only date is injected (no environment). Title generated once (guard on `session.title == null`).
- `clock` and `titler` are OPTIONAL `SessionRuntimeDeps` fields (default clock = `new Date()`; absent titler = no title) — minimizes changes to existing runtime tests.
- Date is day-precision UTC (`now.toISOString().slice(0,10)`) for cache-friendliness.
- Title generation failure must NEVER fail the turn (`.catch(() => null)`).
- Functions ≤50 lines, file ≤300, kebab-case, conventional-commits, footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`, no `any` in source.
- Run `pnpm exec biome lint <files>` clean before each commit. Do NOT pipe `git commit` output through grep/head (SIGPIPE aborts the commit); redirect to a file or run bare.

---

### Task 1: Dynamic date context (R11)

**Files:**
- Create: `packages/agent/src/session/dynamic-context.ts`
- Create test: `packages/agent/src/session/dynamic-context.test.ts`
- Modify: `packages/agent/src/session/turn-messages.ts` (`BuildTurnMessagesDeps.clock?`, inject in `buildTurnMessages`)
- Modify: `packages/agent/src/session/runtime.ts` (`SessionRuntimeDeps.clock?: () => Date`)
- Possibly modify: any existing test that asserts exact system-message text (update to tolerate/await the injected date)

**Interfaces:**
- Produces: `buildDynamicContext(now: Date): string`; `SessionRuntimeDeps.clock?: () => Date`.

- [ ] **Step 1: Create `dynamic-context.ts`**

```ts
/** Day-precision context appended to the system prompt each turn (cache-friendly). */
export function buildDynamicContext(now: Date): string {
	return `Current date: ${now.toISOString().slice(0, 10)}`;
}
```

- [ ] **Step 2: Unit test**

`packages/agent/src/session/dynamic-context.test.ts`:

```ts
import { expect, it } from "vitest";
import { buildDynamicContext } from "./dynamic-context";

it("formats the date to day precision (UTC)", () => {
	const out = buildDynamicContext(new Date("2026-06-24T10:30:00Z"));
	expect(out).toBe("Current date: 2026-06-24");
});
```

Run: `pnpm -F @better-agent/agent test -- dynamic-context` → PASS.

- [ ] **Step 3: Inject in `turn-messages.ts`**

Add the import and `clock` to the deps interface, and compute the injected systemPrompt in `buildTurnMessages` (used by BOTH `toModelMessages` calls via `base`):

```ts
import { buildDynamicContext } from "./dynamic-context";
```

```ts
interface BuildTurnMessagesDeps {
	clock?: () => Date;
	messageStore: MessageStore;
	modelCacheStore: ModelCacheStore;
	sessionStore: SessionStore;
	summarizer: Summarizer;
}
```

In `buildTurnMessages`, replace the `base` construction:

```ts
	const history = await deps.messageStore.listWithParts(sessionId);
	const now = (deps.clock ?? (() => new Date()))();
	const systemPrompt = `${agent.systemPrompt}\n\n${buildDynamicContext(now)}`;
	const base = {
		systemPrompt,
		summary: session.summary,
		compactedThroughSeq: session.compactedThroughSeq,
		history,
	};
```

(The compaction branch already spreads `...base`, so it inherits the injected `systemPrompt`.)

- [ ] **Step 4: Thread `clock` through `runtime.ts`**

Add to `SessionRuntimeDeps`:

```ts
	clock?: () => Date;
```

No call-site change needed: `buildTurnMessages(deps, ...)` already receives the full `deps`, so `deps.clock` flows through.

- [ ] **Step 5: Update any existing system-assertion tests**

Run `pnpm -F @better-agent/agent test` and inspect failures. Any test asserting the exact system message now sees `\n\nCurrent date: <today>` appended. For each failure, either:
- inject a fixed clock in that test's runtime setup (`clock: () => new Date("2026-06-24T00:00:00Z")`) and assert the suffix, OR
- relax the assertion to `expect(system).toContain(agent.systemPrompt)` / `toMatch(/Current date: \d{4}-\d{2}-\d{2}/)`.

Do NOT delete assertions — adapt them. Most runtime tests assert message ROLE/structure, not exact system text, so few should break.

- [ ] **Step 6: Verify + commit**

```bash
pnpm -F @better-agent/agent check-types
pnpm -F @better-agent/agent test
pnpm exec biome lint packages/agent/src/session/dynamic-context.ts packages/agent/src/session/dynamic-context.test.ts packages/agent/src/session/turn-messages.ts packages/agent/src/session/runtime.ts
```
Then commit (bare, no pipe):
```bash
git add packages/agent/src/session/dynamic-context.ts packages/agent/src/session/dynamic-context.test.ts packages/agent/src/session/turn-messages.ts packages/agent/src/session/runtime.ts
git commit -m "$(printf 'feat(agent): inject current date into the system prompt\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: tsc clean, all agent tests pass, lint clean.

---

### Task 2: Auto title generation (R8)

**Files:**
- Create: `packages/agent/src/session/titler.ts` (`Titler` interface + `maybeTitle`)
- Create: `packages/agent/src/session/model-titler.ts` (`createModelTitler`)
- Modify: `packages/agent/src/session/events.ts` (`title` event)
- Modify: `packages/agent/src/session/runtime.ts` (`SessionRuntimeDeps.titler?`; `executeTurn` integration)
- Modify: `packages/agent/src/testing/fakes.ts` (`createFakeTitler`)
- Modify: `apps/server/src/index.ts` (wire `createModelTitler`)
- Create test: `packages/agent/src/session/runtime-title.test.ts`

**Interfaces:**
- Consumes: `SessionStore.setTitle`, `ModelFactory`, `RunEvent`, `Session` (`title: string | null`).
- Produces: `Titler` (`title({providerId, modelId, userText}): Promise<string>`); `maybeTitle(deps, session, agent, userText): Promise<string|null>`; `RunEvent` `{ type:"title"; title:string }`.

- [ ] **Step 1: Create `titler.ts`**

```ts
export interface Titler {
	title(input: {
		providerId: string;
		modelId: string;
		userText: string;
	}): Promise<string>;
}

/** Generate a title only for the first turn; failures degrade to null (never fail the turn). */
export function maybeTitle(
	deps: { titler?: Titler },
	session: { title: string | null },
	agent: { providerId: string; modelId: string },
	userText: string
): Promise<string | null> {
	if (session.title != null || !deps.titler) {
		return Promise.resolve(null);
	}
	return deps.titler
		.title({ providerId: agent.providerId, modelId: agent.modelId, userText })
		.catch(() => null);
}
```

- [ ] **Step 2: Create `model-titler.ts`**

```ts
import { generateText } from "ai";
import type { ModelFactory } from "../provider/model-factory";
import type { Titler } from "./titler";

const TITLE_SYSTEM =
	"Generate a concise chat title (max 6 words) for a conversation that starts with the user's message. Output only the title — no quotes, no trailing punctuation.";

export function createModelTitler(modelFactory: ModelFactory): Titler {
	return {
		async title({ providerId, modelId, userText }) {
			const model = await modelFactory.create(providerId, modelId);
			const result = await generateText({
				model,
				system: TITLE_SYSTEM,
				prompt: userText,
			});
			return result.text.trim();
		},
	};
}
```

- [ ] **Step 3: Add the `title` event**

In `packages/agent/src/session/events.ts`, add to the `RunEvent` union:

```ts
	| { type: "title"; title: string }
```

- [ ] **Step 4: Add `titler` to deps + integrate in `executeTurn`**

In `runtime.ts`: import `maybeTitle`, add `titler?: Titler;` to `SessionRuntimeDeps` (import the type), and modify `executeTurn`:

```ts
import { maybeTitle } from "./titler";
import type { Titler } from "./titler";
```

After `loadContext` + `persistUserTurn`, fire the title (parallel, not awaited):

```ts
	const { session, agent } = await loadContext(deps, sessionId);
	await persistUserTurn(deps.messageStore, sessionId, text);
	const titlePromise = maybeTitle(deps, session, agent, text);
```

Change the tail from `return yield* finalizeAssistant(...)` to capture, then settle the title:

```ts
	const message = yield* finalizeAssistant(deps, {
		agent,
		assistantId: assistant.id,
		fallback: assistant,
		sessionId,
		outcome,
	});
	const title = await titlePromise;
	if (title) {
		await deps.sessionStore.setTitle(sessionId, title);
		yield { type: "title", title };
	}
	return message;
```

- [ ] **Step 5: Add `createFakeTitler` to `fakes.ts`**

Follow the `createFakeSummarizer` pattern. Add:

```ts
import type { Titler } from "../session/titler";

export function createFakeTitler(
	canned = "A Title"
): Titler & { calls: number } {
	const state = { calls: 0 };
	return {
		title() {
			state.calls++;
			return Promise.resolve(canned);
		},
		get calls() {
			return state.calls;
		},
	};
}
```

- [ ] **Step 6: Wire the titler in `apps/server/src/index.ts`**

In `buildRuntime`, add the field next to `summarizer`:

```ts
import { createModelTitler } from "@better-agent/agent/session/model-titler";
```
```ts
		summarizer: createModelSummarizer(deps.modelFactory),
		titler: createModelTitler(deps.modelFactory),
```

- [ ] **Step 7: Tests — `runtime-title.test.ts`**

Mirror `runtime-tools.test.ts` setup but inject a fake titler and a happy single-step text model. Assert:

```ts
import type { LanguageModelV3, LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { expect, it } from "vitest";
import type { ModelFactory } from "../provider/model-factory";
import { createFakeAgentStore } from "../testing/fake-agent-store";
import {
	createFakeCatalogStore,
	createFakeMessageStore,
	createFakeModelStore,
	createFakeSessionStore,
	createFakeSummarizer,
	createFakeTitler,
} from "../testing/fakes";
import type { RunEvent } from "./events";
import { createSessionRuntime } from "./runtime";
import { createInMemorySessionLock } from "./session-lock";
import type { Message } from "./types";

const INPUT = 5;
const OUTPUT = 2;

function v3Usage(input: number, output: number) {
	return {
		inputTokens: { total: input, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
		outputTokens: { total: output, text: undefined, reasoning: undefined },
	};
}

const HAPPY: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "hi" },
	{ type: "text-end", id: "0" },
	{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: v3Usage(INPUT, OUTPUT) },
];

function happyModel(): LanguageModelV3 {
	return new MockLanguageModelV3({
		doStream: () => Promise.resolve({ stream: simulateReadableStream({ chunks: HAPPY }) }),
	});
}

async function setup(titler = createFakeTitler("Greeting Chat"), sessionTitle: string | null = null) {
	const agentStore = createFakeAgentStore();
	const sessionStore = createFakeSessionStore();
	const messageStore = createFakeMessageStore();
	const agent = await agentStore.create({
		name: "Helper", description: "d", systemPrompt: "You are helpful.",
		providerId: "openai", modelId: "gpt-x", params: null, tokenHash: "hash-title",
	});
	const session = await sessionStore.create({ agentId: agent.id });
	if (sessionTitle) {
		await sessionStore.setTitle(session.id, sessionTitle);
	}
	const runtime = createSessionRuntime({
		sessionStore, messageStore, agentStore,
		modelFactory: { create: () => Promise.resolve(happyModel()) } as ModelFactory,
		sessionLock: createInMemorySessionLock(),
		modelCacheStore: createFakeModelStore(),
		providerCatalogStore: createFakeCatalogStore(),
		summarizer: createFakeSummarizer(),
		titler,
	});
	return { runtime, sessionStore, session, titler };
}

async function collect(gen: AsyncGenerator<RunEvent, Message>) {
	const events: RunEvent[] = [];
	let next = await gen.next();
	while (!next.done) { events.push(next.value); next = await gen.next(); }
	return events;
}

it("generates and persists a title on the first turn", async () => {
	const { runtime, sessionStore, session, titler } = await setup();
	const events = await collect(runtime.runTurn({ sessionId: session.id, text: "hello" }));
	expect(events.some((e) => e.type === "title" && e.title === "Greeting Chat")).toBe(true);
	expect((await sessionStore.get(session.id))?.title).toBe("Greeting Chat");
	expect(titler.calls).toBe(1);
});

it("skips title generation when the session already has a title", async () => {
	const { runtime, session, titler } = await setup(createFakeTitler("X"), "Existing");
	const events = await collect(runtime.runTurn({ sessionId: session.id, text: "hello" }));
	expect(events.some((e) => e.type === "title")).toBe(false);
	expect(titler.calls).toBe(0);
});
```

Run: `pnpm -F @better-agent/agent test -- "runtime-title|titler"` → PASS.

- [ ] **Step 8: Verify + commit**

```bash
pnpm -F @better-agent/agent check-types
pnpm -F @better-agent/agent test
pnpm -F server check-types
pnpm exec biome lint packages/agent/src/session/titler.ts packages/agent/src/session/model-titler.ts packages/agent/src/session/events.ts packages/agent/src/session/runtime.ts packages/agent/src/testing/fakes.ts apps/server/src/index.ts packages/agent/src/session/runtime-title.test.ts
```
Then commit (bare, no pipe):
```bash
git add packages/agent/src/session/titler.ts packages/agent/src/session/model-titler.ts packages/agent/src/session/events.ts packages/agent/src/session/runtime.ts packages/agent/src/testing/fakes.ts apps/server/src/index.ts packages/agent/src/session/runtime-title.test.ts
git commit -m "$(printf 'feat(agent): auto-generate a chat title on the first turn\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: agent + server tsc clean; all tests pass; lint clean.

---

## Self-Review Notes

- **Spec coverage:** §2 R11 → Task 1. §3 R8 → Task 2 (titler.ts/model-titler.ts/event/executeTurn/fakes/server). §4 error handling → `maybeTitle.catch` (Task 2 Step 1). §5 decisions honored (date-only, day precision, optional deps, parallel+emit-after-done, generate-once, zero migration).
- **Type consistency:** `buildDynamicContext(now: Date): string` (T1) — same name T1 test. `Titler`/`maybeTitle` signatures identical across titler.ts (def), runtime.ts (use), fakes.ts (impl), tests. `clock?: () => Date` consistent in BuildTurnMessagesDeps + SessionRuntimeDeps. `title` event shape `{type:"title"; title:string}` consistent events.ts + executeTurn + tests.
- **Ordering:** Task 1 and Task 2 are independent (both touch runtime.ts deps interface but different fields); do Task 1 first to keep diffs small. Both edit `SessionRuntimeDeps` — Task 2's implementer must keep Task 1's `clock?` field.
- **YAGNI:** no environment injection, no title rename, no migration, title once.
