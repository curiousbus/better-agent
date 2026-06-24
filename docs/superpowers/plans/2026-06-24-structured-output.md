# Structured Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional `outputSchema` to `run`/`prompt` so an agent can use tools then return a JSON object that strictly matches the schema, via an injected `StructuredOutput` tool + `toolChoice:'required'` + `stopWhen hasToolCall`.

**Architecture:** When `outputSchema` is provided, runtime appends a no-op `StructuredOutput` tool (its `inputSchema` = the schema) alongside the remote tools, runs with `toolChoice:'required'` and `stopWhen:[stepCountIs(50), hasToolCall('StructuredOutput')]`. The model calls remote tools to gather info, then calls `StructuredOutput` to "submit" — its args ARE the result, captured in `drainStream` into `StreamOutcome.structured`, surfaced on the `done` event and on `run`'s return value. Zero DB migration (the call persists as a normal tool-call part).

**Tech Stack:** TypeScript, AI SDK v6 (`ai@6.0.205`), oRPC, vitest + `ai/test` `MockLanguageModelV3`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-24-structured-output-design.md`. Every task implicitly includes its decisions.
- `outputSchema` crosses the network as **JSON Schema** = `Record<string, unknown>` (same as `remoteToolSchema.parameters`); never zod.
- **Zero DB migration.** The structured result persists as the `StructuredOutput` tool-call part; no new `Message` column.
- Tool name constant is exactly `"StructuredOutput"` (`STRUCTURED_OUTPUT_TOOL_NAME`).
- `run` returns `Message & { structured: unknown | null }` (append `structured`, NOT a `{message, structured}` envelope).
- Non-structured behavior must be byte-identical (no `toolChoice`, single-condition `stopWhen`).
- Functions ≤ 50 lines; file ≤ 300 lines; kebab-case; conventional-commits; commit footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; no `any` in source; run `pnpm exec biome lint <files>` clean before each commit.

---

### Task 1: Agent-core structured output

**Files:**
- Create: `packages/agent/src/session/structured-output.ts`
- Create test: `packages/agent/src/session/structured-output.test.ts`
- Modify: `packages/agent/src/session/retry-helpers.ts` (`StreamOutcome.structured` + `resetOutcome`)
- Modify: `packages/agent/src/session/runtime-drain.ts` (`drainToolCall` captures structured)
- Modify: `packages/agent/src/session/events.ts` (`done` gains `structured`)
- Modify: `packages/agent/src/session/runtime.ts` (`RunTurnInput`, `AttemptArgs`, `runAttempt`, `executeTurn`, `finalizeAssistant`)
- Create test: `packages/agent/src/session/runtime-structured.test.ts`

**Interfaces:**
- Consumes: existing `ToolDef` (`{name, description, parameters: Record<string,unknown>, execute}`), `ExecuteResult` (`{output: string; isError?: boolean}`), `StreamOutcome`, `DrainCtx`, `AttemptArgs`, `FinalizeArgs`.
- Produces (consumed by Task 2):
  - `RunTurnInput.outputSchema?: Record<string, unknown>`
  - `RunEvent` `done` variant: `{ type:"done"; usage; finishReason; structured?: unknown }`
  - `runTurn` still returns `Message`; the structured value rides the `done` event.

- [ ] **Step 1: Create the StructuredOutput tool def**

`packages/agent/src/session/structured-output.ts`:

```ts
import type { ToolDef } from "../tool/types";

export const STRUCTURED_OUTPUT_TOOL_NAME = "StructuredOutput";

const DESCRIPTION =
	"Submit your final answer as structured JSON. Call this tool exactly once, when you have everything you need; its arguments are your final result.";

/** A no-op server-side tool whose call args carry the structured result. */
export function buildStructuredOutputToolDef(
	outputSchema: Record<string, unknown>
): ToolDef {
	return {
		name: STRUCTURED_OUTPUT_TOOL_NAME,
		description: DESCRIPTION,
		parameters: outputSchema,
		execute: () => Promise.resolve({ output: "" }),
	};
}
```

- [ ] **Step 2: Unit-test the tool def (write, run → fail, it passes once Step 1 exists)**

`packages/agent/src/session/structured-output.test.ts`:

```ts
import { expect, it } from "vitest";
import {
	buildStructuredOutputToolDef,
	STRUCTURED_OUTPUT_TOOL_NAME,
} from "./structured-output";

it("builds a no-op tool whose parameters are the output schema", async () => {
	const schema = { type: "object", properties: { n: { type: "number" } } };
	const def = buildStructuredOutputToolDef(schema);
	expect(def.name).toBe(STRUCTURED_OUTPUT_TOOL_NAME);
	expect(def.parameters).toBe(schema);
	await expect(def.execute({ n: 1 }, {} as never)).resolves.toEqual({
		output: "",
	});
});
```

Run: `pnpm -F @better-agent/agent test -- structured-output` → PASS.

- [ ] **Step 3: Add `structured` to StreamOutcome**

In `packages/agent/src/session/retry-helpers.ts`, add the field to the interface and reset it:

```ts
export interface StreamOutcome {
	emittedOutput: boolean;
	errorCategory: ErrorCategory | null;
	errorMessage: string | null;
	finishReason: FinishReason;
	status: "complete" | "error" | "aborted";
	structured: unknown;
	usage: MessageUsage | null;
}
```

In `resetOutcome`, add `state.structured = null;` (alongside the other resets).

- [ ] **Step 4: Capture structured in `drainToolCall`**

In `packages/agent/src/session/runtime-drain.ts`, import the constant and set the outcome when the call is the StructuredOutput tool:

```ts
import { STRUCTURED_OUTPUT_TOOL_NAME } from "./structured-output";
```

In `drainToolCall`, after computing `args` and before/after appending the part, add:

```ts
	if (toolName === STRUCTURED_OUTPUT_TOOL_NAME) {
		state.structured = args;
	}
```

(Keep the existing append + `state.emittedOutput = true` + yield.)

- [ ] **Step 5: Add `structured` to the `done` event**

In `packages/agent/src/session/events.ts`, change the `done` variant:

```ts
	| { type: "done"; usage: MessageUsage | null; finishReason: FinishReason; structured?: unknown }
```

- [ ] **Step 6: Thread `outputSchema`/`structuredOutput` through runtime + emit on done**

In `packages/agent/src/session/runtime.ts`:

1. Import additions:
```ts
import { hasToolCall, stepCountIs, streamText } from "ai";
import { buildStructuredOutputToolDef } from "./structured-output";
```
2. `RunTurnInput` gains `outputSchema?: Record<string, unknown>;`.
3. `AttemptArgs` gains `structuredOutput?: boolean;`.
4. In `runAttempt`, make `stopWhen`/`toolChoice` conditional on `args.structuredOutput`:
```ts
		const result = streamText({
			model,
			messages,
			providerOptions,
			stopWhen: args.structuredOutput
				? [stepCountIs(DEFAULT_MAX_STEPS), hasToolCall(STRUCTURED_OUTPUT_TOOL_NAME)]
				: stepCountIs(DEFAULT_MAX_STEPS),
			tools,
			...(args.structuredOutput ? { toolChoice: "required" as const } : {}),
			experimental_repairToolCall: () => Promise.resolve(null),
			abortSignal,
			maxRetries: 0,
			...buildSettings(params),
		});
```
   (Import `STRUCTURED_OUTPUT_TOOL_NAME` too.) Keep the existing `buildTools(...)` call and its `cacheLastToolDef` arg unchanged.
5. In `executeTurn`, build the tool list with the injected tool and set the flag:
```ts
	const toolDefs = [...(tools ?? [])];
	if (input.outputSchema) {
		toolDefs.push(buildStructuredOutputToolDef(input.outputSchema));
	}
```
   Use `toolDefs` for `ctx.toolDefs` (replace `toolDefs: tools ?? []`), and in the `streamAssistant` args add `structuredOutput: input.outputSchema != null`.
6. In `finalizeAssistant`, the success branch emits structured:
```ts
		yield { type: "done", usage, finishReason: outcome.finishReason, structured: outcome.structured };
```

- [ ] **Step 7: End-to-end runtime tests**

`packages/agent/src/session/runtime-structured.test.ts` — model setup mirrors `runtime-tools.test.ts` (`MockLanguageModelV3` + `simulateReadableStream`; copy the `setup`, `collectEvents`, `v3Usage` helpers or import the pattern). Use these chunk scripts:

```ts
import type {
	LanguageModelV3,
	LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
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
} from "../testing/fakes";
import type { ToolDef } from "../tool/types";
import type { RunEvent } from "./events";
import { createSessionRuntime } from "./runtime";
import { createInMemorySessionLock } from "./session-lock";
import type { Message } from "./types";

const SCHEMA = { type: "object", properties: { answer: { type: "number" } } };

function v3Usage(input: number, output: number) {
	return {
		inputTokens: { total: input, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
		outputTokens: { total: output, text: undefined, reasoning: undefined },
	};
}

function structuredCallChunks(value: unknown): LanguageModelV3StreamPart[] {
	return [
		{ type: "tool-call", toolCallId: "so-1", toolName: "StructuredOutput", input: JSON.stringify(value) },
		{ type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: v3Usage(10, 5) },
	];
}

async function setup(model: LanguageModelV3) {
	const agentStore = createFakeAgentStore();
	const sessionStore = createFakeSessionStore();
	const messageStore = createFakeMessageStore();
	const agent = await agentStore.create({
		name: "Helper", description: "d", systemPrompt: "You are helpful.",
		providerId: "openai", modelId: "gpt-x", params: null, tokenHash: "hash-so",
	});
	const session = await sessionStore.create({ agentId: agent.id });
	const runtime = createSessionRuntime({
		sessionStore, messageStore, agentStore,
		modelFactory: { create: () => Promise.resolve(model) } as ModelFactory,
		sessionLock: createInMemorySessionLock(),
		modelCacheStore: createFakeModelStore(),
		providerCatalogStore: createFakeCatalogStore(),
		summarizer: createFakeSummarizer(),
	});
	return { runtime, messageStore, session };
}

async function collect(gen: AsyncGenerator<RunEvent, Message>) {
	const events: RunEvent[] = [];
	let next = await gen.next();
	while (!next.done) { events.push(next.value); next = await gen.next(); }
	return events;
}

it("returns the structured args when the model submits in one step", async () => {
	const model = new MockLanguageModelV3({
		doStream: () => Promise.resolve({ stream: simulateReadableStream({ chunks: structuredCallChunks({ answer: 42 }) }) }),
	});
	const { runtime, session } = await setup(model);
	const events = await collect(runtime.runTurn({ sessionId: session.id, text: "go", outputSchema: SCHEMA }));
	const done = events.find((e) => e.type === "done");
	expect(done && "structured" in done && done.structured).toEqual({ answer: 42 });
});

it("gathers via a tool then submits structured output", async () => {
	const echoTool: ToolDef = {
		name: "echo", description: "echo", parameters: { type: "object", properties: {} },
		execute: () => Promise.resolve({ output: "DATA" }),
	};
	let step = 0;
	const model = new MockLanguageModelV3({
		doStream: () => {
			step++;
			const chunks: LanguageModelV3StreamPart[] = step === 1
				? [
					{ type: "tool-call", toolCallId: "echo-1", toolName: "echo", input: "{}" },
					{ type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: v3Usage(10, 5) },
				]
				: structuredCallChunks({ answer: 7 });
			return Promise.resolve({ stream: simulateReadableStream({ chunks }) });
		},
	});
	const { runtime, session } = await setup(model);
	const events = await collect(runtime.runTurn({ sessionId: session.id, text: "go", tools: [echoTool], outputSchema: SCHEMA }));
	expect(events.some((e) => e.type === "tool-result")).toBe(true);
	const done = events.find((e) => e.type === "done");
	expect(done && "structured" in done && done.structured).toEqual({ answer: 7 });
});

it("leaves structured null when the model never submits", async () => {
	const HAPPY: LanguageModelV3StreamPart[] = [
		{ type: "text-start", id: "0" },
		{ type: "text-delta", id: "0", delta: "hi" },
		{ type: "text-end", id: "0" },
		{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: v3Usage(5, 2) },
	];
	const model = new MockLanguageModelV3({
		doStream: () => Promise.resolve({ stream: simulateReadableStream({ chunks: HAPPY }) }),
	});
	const { runtime, session } = await setup(model);
	const events = await collect(runtime.runTurn({ sessionId: session.id, text: "go", outputSchema: SCHEMA }));
	const done = events.find((e) => e.type === "done");
	expect(done && "structured" in done ? done.structured : "MISSING").toBeNull();
});
```

Run: `pnpm -F @better-agent/agent test -- "structured|runtime"` → all PASS (existing runtime/tools tests still green).

- [ ] **Step 8: Verify + commit**

```bash
pnpm -F @better-agent/agent check-types
pnpm -F @better-agent/agent test
pnpm exec biome lint packages/agent/src/session/structured-output.ts packages/agent/src/session/structured-output.test.ts packages/agent/src/session/retry-helpers.ts packages/agent/src/session/runtime-drain.ts packages/agent/src/session/events.ts packages/agent/src/session/runtime.ts packages/agent/src/session/runtime-structured.test.ts
git add packages/agent/src/session/structured-output.ts packages/agent/src/session/structured-output.test.ts packages/agent/src/session/retry-helpers.ts packages/agent/src/session/runtime-drain.ts packages/agent/src/session/events.ts packages/agent/src/session/runtime.ts packages/agent/src/session/runtime-structured.test.ts
git commit -m "$(cat <<'EOF'
feat(agent): structured output via injected StructuredOutput tool

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```
Expected: tsc clean; all agent tests pass; lint clean.

---

### Task 2: API + client passthrough

**Files:**
- Modify: `packages/api/src/routers/sessions.ts` (`promptInput.outputSchema`, `run` returns `{...message, structured}`, add `drainWithStructured`)
- Modify: `packages/api/src/routers/user-sessions.ts` (same passthrough on its `run`/`prompt`)
- Modify: `packages/client/src/index.ts` (`RunOptions.outputSchema`, `run`/`stream` passthrough, `runWithTools` captures structured)
- Modify test: `packages/client/src/index.test.ts`

**Interfaces:**
- Consumes from Task 1: `RunTurnInput.outputSchema`, `done.structured`.
- Produces: `run`/`prompt` accept `outputSchema?: Record<string, unknown>`; `run` returns `Message & { structured: unknown }`; client `RunOptions.outputSchema`.

- [ ] **Step 1: API — outputSchema input + drainWithStructured + run return (`sessions.ts`)**

Add the optional input alongside the existing `promptInput` fields:

```ts
const promptInput = z.object({
	sessionId: z.uuid(),
	text: z.string().min(1),
	tools: z.array(remoteToolSchema).optional(),
	outputSchema: z.record(z.string(), z.unknown()).optional(),
});
```

Add a drain variant next to `drain`:

```ts
export async function drainWithStructured(
	gen: AsyncGenerator<RunEvent, Message>
): Promise<Message & { structured: unknown }> {
	let structured: unknown = null;
	let next = await gen.next();
	while (!next.done) {
		if (next.value.type === "done") {
			structured = next.value.structured ?? null;
		}
		next = await gen.next();
	}
	return { ...next.value, structured };
}
```

Update the `run` handler to pass `outputSchema` and return the structured-augmented message:

```ts
	run: agentProcedure
		.input(promptInput)
		.handler(async ({ input, context, signal }) => {
			await requireOwnedSession(context, context.authedAgent.id, input.sessionId);
			const toolDefs = input.tools
				? buildRemoteToolDefs(input.tools, context.services.pendingToolCallStore)
				: undefined;
			return drainWithStructured(
				context.services.runtime.runTurn({
					sessionId: input.sessionId,
					text: input.text,
					tools: toolDefs,
					outputSchema: input.outputSchema,
					abortSignal: signal,
				})
			);
		}),
```

In `streamTurn` (the `prompt` path), forward `outputSchema` into `runTurn({ ..., tools: toolDefs, outputSchema: input.tools? ... })` — pass `input.outputSchema` through the same `runTurn` call. (The `done` event already carries `structured`.)

- [ ] **Step 2: API — same passthrough in `user-sessions.ts`**

Mirror Step 1 in `packages/api/src/routers/user-sessions.ts`: add `outputSchema` to its `promptInput`, import/reuse `drainWithStructured` from `./sessions` (export it there), pass `outputSchema` into both its `run` and `prompt` `runTurn` calls.

- [ ] **Step 3: client — outputSchema passthrough + structured capture (`index.ts`)**

1. `RunOptions` gains `outputSchema?: Record<string, unknown>;`.
2. `streamTurn` forwards it:
```ts
	const events = await client.sessions.prompt(
		{ sessionId, text, tools: toolDefs, outputSchema: options?.outputSchema },
		{ signal: options?.signal }
	);
```
3. Simple `run` path forwards it:
```ts
			return client.sessions.run(
				{ sessionId, text, outputSchema: options?.outputSchema },
				{ signal: options?.signal }
			);
```
4. `runWithTools` captures structured from the drained stream and appends it:
```ts
async function runWithTools(
	client: Client,
	stream: AgentClient["stream"],
	text: string,
	options: RunOptions & { tools: ClientToolDef[] }
): Promise<Message> {
	const sessionId = options.sessionId ?? (await client.sessions.create({})).id;
	let structured: unknown = null;
	for await (const event of stream(text, { ...options, sessionId })) {
		if (event.type === "done") {
			structured = (event as { structured?: unknown }).structured ?? null;
		}
	}
	const history = await client.sessions.listMessages({ sessionId }, { signal: options.signal });
	const lastAssistant = [...history].reverse().find((item) => item.message.role === "assistant");
	if (!lastAssistant) {
		throw new Error("No assistant message found after tool-assisted run");
	}
	return { ...lastAssistant.message, structured } as Message;
}
```
5. Mirror the `outputSchema` passthrough in `createUserSessionClientFrom`'s `run` (`client.userSessions.run({ ..., outputSchema })`) and `streamTurn`-equivalent if it has its own; reuse the shared `streamTurn`/`runWithTools` where possible (they take `client` and `client.sessions.*` — note the user-plane builder ends with `return createAgentClientFrom(client)` so the shared helpers already cover it; just add `outputSchema` to the `userSessions.run` call in that builder if it has a distinct `run`).

> Note: `Message` is `Awaited<ReturnType<Client["sessions"]["run"]>>`, which after Step 1 includes `structured`. The `{ ...lastAssistant.message, structured } as Message` cast supplies it for the tool-assisted path. Verify via tsc that no other `as Message` site breaks.

- [ ] **Step 4: client tests**

In `packages/client/src/index.test.ts`, add a case asserting `run` forwards `outputSchema` and surfaces `structured`. Follow the file's existing mock-client pattern (it injects a fake `Client`). Assert: calling `run(text, { outputSchema })` calls `client.sessions.run` with `outputSchema` and returns an object whose `.structured` equals the fake's returned structured value. (Read the existing tests first to match the mock shape.)

- [ ] **Step 5: Verify + commit**

```bash
pnpm -F @better-agent/api check-types && pnpm -F @better-agent/client check-types
pnpm -F @better-agent/client test
pnpm exec biome lint packages/api/src/routers/sessions.ts packages/api/src/routers/user-sessions.ts packages/client/src/index.ts packages/client/src/index.test.ts
git add packages/api/src/routers/sessions.ts packages/api/src/routers/user-sessions.ts packages/client/src/index.ts packages/client/src/index.test.ts
git commit -m "$(cat <<'EOF'
feat(client): pass outputSchema through run/prompt and surface structured

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```
Expected: api + client tsc clean; client tests pass; lint clean.

---

## Self-Review Notes

- **Spec coverage:** §2 mechanism → Task 1 Steps 1,6. §3.1 tool → A1. §3.2 RunTurnInput/AttemptArgs → A6. §3.3 runAttempt → A6. §3.4 executeTurn inject → A6. §3.5 drain capture + StreamOutcome → A3,A4. §3.6 done → A5,A6. §3.7 API → B1,B2. §3.8 client → B3. §5 error (no submit → null) → A7 test 3. §6 tests → A7, B4.
- **Type consistency:** `STRUCTURED_OUTPUT_TOOL_NAME` defined A1, used A4/A6. `outputSchema: Record<string,unknown>` consistent across RunTurnInput (A6), promptInput (B1/B2), RunOptions (B3). `done.structured?: unknown` (A5) read by `drainWithStructured` (B1) and `runWithTools` (B3). `run` returns `Message & { structured }` (B1) — client `Message` recomputes to include it (B3 note).
- **Ordering:** Task 1 before B (B consumes `RunTurnInput.outputSchema` + `done.structured`).
- **YAGNI:** no generic server-tool framework; no Message migration; no Gemini cachedContent; structured only on success path.
