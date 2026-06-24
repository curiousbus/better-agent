# Tool Loop Core (T1 + T4 + T7) Implementation Plan

> **Plan A of 3** for the tool system. Plan B = remote tools + Redis pending store (T2); Plan C = prompt caching + accounting (T3 + 3.4). This plan delivers a working multi-step agentic loop with **in-process** tools — no Redis, no client-SDK changes — end-to-end testable on its own.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the session runtime run a multi-step tool loop: pass tool definitions into a turn, have the model call them, execute them, persist the tool-call/tool-result parts + emit events, and feed the results back so the model continues — until it produces a final answer.

**Architecture:** A new `packages/agent/src/tool/` module: a `ToolDef` abstraction, a registry that adapts `ToolDef`s into AI-SDK tools (wrapping each `execute` with output truncation), and a truncation helper. The runtime passes the registry's tools to `streamText` with a raised `stopWhen` step cap and `experimental_repairToolCall`; the AI SDK runs the multi-step loop internally and emits tool chunks on `fullStream`, which `drainStream` persists as `tool-call`/`tool-result` parts and surfaces as new `RunEvent`s. `toModelMessages` is rewritten to replay stored tool parts as AI-SDK tool messages so prior-turn tool use survives into later turns.

**Tech Stack:** TypeScript, Vercel AI SDK v6 (`tool`, `jsonSchema`, `stepCountIs`, `experimental_repairToolCall`, `fullStream` tool chunks, tool/assistant `ModelMessage` format), Vitest (`ai/test` `MockLanguageModelV3`).

**Source design (validated):** `docs/research/agent-gap-analysis.md` §3.1 (T1), §3.1.7/§3.2.2 (T4 truncation), §2.1 T7 (repair).

## Global Constraints

- **Decisions (binding):**
  - **In-process tools only** this plan. The registry adapts `ToolDef`s whose `execute` runs in-process. The *remote* source (execute parks on a pending store) is Plan B; the registry's adaptation seam must not assume in-process (keep `execute` async and source-agnostic).
  - **Multi-step cap** via a constant `DEFAULT_MAX_STEPS = 50` (no agent field, no migration). Tools enter a turn via `RunTurnInput.tools?: ToolDef[]` (default `[]` → behaves exactly as today: `tools: {}`, single step).
  - **Truncation** (T4): a tool output over `MAX_OUTPUT_BYTES = 51_200` (50 KB) **or** `MAX_OUTPUT_LINES = 2000` is cut to a head slice plus a trailing notice; the registry wraps every tool's `execute` so all sources get it for free. (This plan keeps the full output in memory only — the "write overflow to a file" path is deferred; the notice tells the model the output was truncated.)
  - **Repair** (T7): pass `experimental_repairToolCall` to coerce malformed tool-call arguments (re-ask the model to fix), per the AI SDK option.
  - **No new exported public surface beyond `tool/`**; reuse the existing `tool-call`/`tool-result` part content shapes in `session/types.ts` (`{callId, toolName, args}` / `{callId, isError, result}`) — they already exist.
- **AI-SDK shape verification:** the exact `fullStream` tool-chunk field names and the tool/assistant `ModelMessage` content shapes are version-specific. Where a task depends on them, it includes a step to verify against the installed `ai` / `@ai-sdk/provider` types (in `node_modules/.pnpm/ai@*`) before writing — do not guess field names.
- **Code rules (Ultracite/Biome + project):** no `any` (use `unknown`); `interface` over `type` for object shapes; `import type` for type-only imports; `for...of` over `.forEach`; files ≤300 lines, functions ≤50 lines, complexity ≤10; no magic numbers (use the named constants above); kebab-case filenames; specific imports. `pnpm dlx ultracite fix <paths>` before each commit; lefthook blocks non-compliant commits.
- **Tests:** `pnpm -F @better-agent/agent exec vitest run src/<path>.test.ts`. Typecheck: `pnpm -F @better-agent/agent exec tsc --noEmit`.
- **Commits:** conventional-commits subject; every message MUST end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `packages/agent/src/tool/truncate.ts` (new) — `truncateOutput(text): { output, truncated }`.
- `packages/agent/src/tool/types.ts` (new) — `ToolDef`, `ToolContext`, `ExecuteResult`, `JsonSchema`.
- `packages/agent/src/tool/registry.ts` (new) — `buildTools(defs, ctx): Record<string, AiTool>`.
- `packages/agent/src/session/events.ts` (modify) — add `tool-call` / `tool-result` `RunEvent`s.
- `packages/agent/src/session/runtime.ts` + retry helpers (modify) — tools into `streamText`, raised `stopWhen`, `experimental_repairToolCall`, `drainStream` tool branches.
- `packages/agent/src/session/to-model-messages.ts` (modify) — replay tool parts as tool/assistant messages.
- Tests alongside each.

---

### Task 1: Tool output truncation (T4)

**Files:**
- Create: `packages/agent/src/tool/truncate.ts`
- Create: `packages/agent/src/tool/truncate.test.ts`

**Interfaces:**
- Produces: `truncateOutput(text: string): { output: string; truncated: boolean }`; exported consts `MAX_OUTPUT_BYTES = 51_200`, `MAX_OUTPUT_LINES = 2000`.

- [ ] **Step 1: Write the failing test**

`packages/agent/src/tool/truncate.test.ts`:
```ts
import { expect, it } from "vitest";
import { MAX_OUTPUT_LINES, truncateOutput } from "./truncate";

it("passes small output through unchanged", () => {
	const r = truncateOutput("hello");
	expect(r).toEqual({ output: "hello", truncated: false });
});

it("truncates output longer than the line limit and appends a notice", () => {
	const text = Array.from({ length: MAX_OUTPUT_LINES + 50 }, (_, i) => `line ${i}`).join("\n");
	const r = truncateOutput(text);
	expect(r.truncated).toBe(true);
	expect(r.output.split("\n").length).toBeLessThanOrEqual(MAX_OUTPUT_LINES + 1);
	expect(r.output).toContain("truncated");
});

it("truncates output larger than the byte limit", () => {
	const r = truncateOutput("x".repeat(60_000));
	expect(r.truncated).toBe(true);
	expect(r.output.length).toBeLessThan(60_000);
	expect(r.output).toContain("truncated");
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm -F @better-agent/agent exec vitest run src/tool/truncate.test.ts` → FAIL (no module).

- [ ] **Step 3: Implement**

`packages/agent/src/tool/truncate.ts`:
```ts
export const MAX_OUTPUT_BYTES = 51_200;
export const MAX_OUTPUT_LINES = 2000;

function notice(original: number): string {
	return `\n\n[output truncated — ${original} chars total; showing the head]`;
}

export function truncateOutput(text: string): {
	output: string;
	truncated: boolean;
} {
	const lines = text.split("\n");
	let head = text;
	let truncated = false;
	if (lines.length > MAX_OUTPUT_LINES) {
		head = lines.slice(0, MAX_OUTPUT_LINES).join("\n");
		truncated = true;
	}
	if (head.length > MAX_OUTPUT_BYTES) {
		head = head.slice(0, MAX_OUTPUT_BYTES);
		truncated = true;
	}
	return truncated
		? { output: head + notice(text.length), truncated: true }
		: { output: text, truncated: false };
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
pnpm dlx ultracite fix packages/agent/src/tool/truncate.ts packages/agent/src/tool/truncate.test.ts
git add packages/agent/src/tool/truncate.ts packages/agent/src/tool/truncate.test.ts
git commit -m "feat(agent): tool output truncation"
```

---

### Task 2: Tool abstraction + registry (T1 core)

**Files:**
- Create: `packages/agent/src/tool/types.ts`
- Create: `packages/agent/src/tool/registry.ts`
- Create: `packages/agent/src/tool/registry.test.ts`

**Interfaces:**
- Consumes: `truncateOutput` (Task 1).
- Produces:
  - `interface ExecuteResult { output: string; isError?: boolean }`
  - `interface ToolContext { sessionId: string; messageId: string; agentId: string; callId: string; abortSignal: AbortSignal }`
  - `type JsonSchema = Record<string, unknown>`
  - `interface ToolDef { name: string; description: string; parameters: JsonSchema; execute(args: unknown, ctx: ToolContext): Promise<ExecuteResult> }`
  - `buildTools(defs: ToolDef[], ctxBase: Omit<ToolContext, "callId">): Record<string, ReturnType<typeof tool>>` — adapts each `ToolDef` to an AI-SDK tool whose `execute` runs `def.execute` (with a fresh `callId`), truncates the `output`, and returns the truncated string. Throws on duplicate tool names.

- [ ] **Step 1: Verify the AI-SDK `tool()` + `jsonSchema()` API**

Read the installed types so the wrapper matches v6 exactly: `node_modules/.pnpm/ai@*/node_modules/ai/dist/index.d.ts` — confirm `tool({ description, inputSchema, execute })`, that `inputSchema` accepts `jsonSchema(schema)`, the `execute(args, options)` signature (and what `options` carries, e.g. `toolCallId`, `abortSignal`), and the return type of `tool()`. Note the exact names; adjust the code below if they differ.

- [ ] **Step 2: Write the failing test**

`packages/agent/src/tool/registry.test.ts`:
```ts
import { expect, it } from "vitest";
import { buildTools } from "./registry";
import type { ToolDef } from "./types";

const ctxBase = {
	sessionId: "s1",
	messageId: "m1",
	agentId: "a1",
	abortSignal: new AbortController().signal,
};

function echoTool(over?: Partial<ToolDef>): ToolDef {
	return {
		name: "echo",
		description: "echo the input",
		parameters: { type: "object", properties: { v: { type: "string" } } },
		execute: ({ v }: { v: string } | never) =>
			Promise.resolve({ output: `echo:${(v as string) ?? ""}` }),
		...over,
	};
}

it("adapts a ToolDef into an AI-SDK tool whose execute runs the def", async () => {
	const tools = buildTools([echoTool()], ctxBase);
	expect(Object.keys(tools)).toEqual(["echo"]);
	// AI-SDK tool execute signature: execute(args, options)
	const out = await tools.echo.execute(
		{ v: "hi" },
		{ toolCallId: "c1", messages: [] }
	);
	expect(out).toBe("echo:hi");
});

it("truncates very large tool output", async () => {
	const big = echoTool({
		execute: () => Promise.resolve({ output: "x".repeat(60_000) }),
	});
	const tools = buildTools([big], ctxBase);
	const out = (await tools.echo.execute({ v: "" }, { toolCallId: "c1", messages: [] })) as string;
	expect(out).toContain("truncated");
});

it("throws on duplicate tool names", () => {
	expect(() => buildTools([echoTool(), echoTool()], ctxBase)).toThrow(/duplicate/i);
});
```
(If Step 1 shows `execute`'s 2nd arg shape differs, fix the test's `options` object to match.)

- [ ] **Step 3: Run to verify it fails** — FAIL (no module).

- [ ] **Step 4: Implement types + registry**

`packages/agent/src/tool/types.ts`:
```ts
export interface ExecuteResult {
	output: string;
	isError?: boolean;
}

export interface ToolContext {
	sessionId: string;
	messageId: string;
	agentId: string;
	callId: string;
	abortSignal: AbortSignal;
}

export type JsonSchema = Record<string, unknown>;

export interface ToolDef {
	name: string;
	description: string;
	parameters: JsonSchema;
	execute(args: unknown, ctx: ToolContext): Promise<ExecuteResult>;
}
```

`packages/agent/src/tool/registry.ts`:
```ts
import { jsonSchema, tool } from "ai";
import { truncateOutput } from "./truncate";
import type { ToolContext, ToolDef } from "./types";

type CtxBase = Omit<ToolContext, "callId">;

export function buildTools(
	defs: ToolDef[],
	ctxBase: CtxBase
): Record<string, ReturnType<typeof tool>> {
	const tools: Record<string, ReturnType<typeof tool>> = {};
	for (const def of defs) {
		if (tools[def.name]) {
			throw new Error(`Duplicate tool name: ${def.name}`);
		}
		tools[def.name] = tool({
			description: def.description,
			inputSchema: jsonSchema(def.parameters),
			execute: async (args: unknown, options: { toolCallId: string }) => {
				const result = await def.execute(args, {
					...ctxBase,
					callId: options.toolCallId,
				});
				return truncateOutput(result.output).output;
			},
		});
	}
	return tools;
}
```
(Adjust the `options` param type to the verified v6 shape from Step 1.)

- [ ] **Step 5: Run to verify it passes** — PASS (3 tests). Then `pnpm -F @better-agent/agent exec tsc --noEmit` → clean.

- [ ] **Step 6: Commit**
```bash
pnpm dlx ultracite fix packages/agent/src/tool
git add packages/agent/src/tool/types.ts packages/agent/src/tool/registry.ts packages/agent/src/tool/registry.test.ts
git commit -m "feat(agent): tool abstraction and registry"
```

---

### Task 3: Tool RunEvents

**Files:**
- Modify: `packages/agent/src/session/events.ts`

**Interfaces:**
- Produces: `RunEvent` gains `| { type: "tool-call"; callId: string; toolName: string; args: unknown }` and `| { type: "tool-result"; callId: string; result: unknown; isError: boolean }`.

- [ ] **Step 1: Add the variants**

In `packages/agent/src/session/events.ts`, add the two variants to the `RunEvent` union (and remove the "📐 留待工具阶段" caveat from the comment):
```ts
	| { type: "tool-call"; callId: string; toolName: string; args: unknown }
	| { type: "tool-result"; callId: string; result: unknown; isError: boolean }
```

- [ ] **Step 2: Typecheck** — `pnpm -F @better-agent/agent exec tsc --noEmit` → clean (additive union change; existing exhaustive switches that don't handle the new variants will error — if any do, that's Task 4's drainStream and the api streamTurn passthrough, addressed there; if the typecheck flags an unrelated exhaustive consumer, handle it minimally). 

- [ ] **Step 3: Commit**
```bash
pnpm dlx ultracite fix packages/agent/src/session/events.ts
git add packages/agent/src/session/events.ts
git commit -m "feat(agent): add tool-call/tool-result run events"
```

---

### Task 4: Multi-step loop + drainStream tool branches (T1 + T7)

**Files:**
- Modify: `packages/agent/src/session/runtime.ts`
- Modify: `packages/agent/src/session/runtime.test.ts` (or a new `runtime-tools.test.ts` if the file would exceed 300 lines — follow the existing `runtime-retry.test.ts`/`runtime-overflow.test.ts` split precedent)

**Interfaces:**
- Consumes: `buildTools` (Task 2); tool `RunEvent`s (Task 3); `ToolDef` (Task 2).
- Produces: `RunTurnInput` gains `tools?: ToolDef[]`. The runtime builds tools, passes them to `streamText` with `stopWhen: stepCountIs(DEFAULT_MAX_STEPS)` (replacing `MAX_STEPS = 1`) and `experimental_repairToolCall`, and `drainStream` persists `tool-call`/`tool-result` parts + yields the matching events.

- [ ] **Step 1: Verify the `fullStream` tool-chunk shapes + `experimental_repairToolCall` signature**

Read the installed `ai` types: confirm the `fullStream` chunk variants for tool use (likely `type: "tool-call"` with `toolCallId`/`toolName`/`input`, and `type: "tool-result"` with `toolCallId`/`toolName`/`output`; there may also be `tool-input-start`/`tool-input-delta` chunks — decide whether to surface them or ignore them this plan). Confirm the `experimental_repairToolCall` option shape. Record exact field names; the branch code below uses placeholders `toolCallId`/`toolName`/`input`/`output` — fix to match.

- [ ] **Step 2: Write the failing integration test**

Add a test (reuse the file's seed helper + a `MockLanguageModelV3` scripted to emit a tool-call chunk on the first step then text on the second; provide one in-process `ToolDef`). It must assert: (a) a `tool-call` event and a `tool-result` event were yielded; (b) a `tool-call` part and a `tool-result` part were persisted for the assistant turn; (c) the tool's `execute` ran. Shape:
```ts
it("runs an in-process tool and persists the call + result", async () => {
	const tool = { name: "echo", description: "d", parameters: { type: "object" }, execute: () => Promise.resolve({ output: "RESULT" }) };
	// model: step 1 emits a tool-call for "echo"; after the tool result, step 2 emits text + finish.
	const events = await collectEvents(runtime.runTurn({ sessionId, text: "go", tools: [tool] }));
	expect(events.some((e) => e.type === "tool-call")).toBe(true);
	expect(events.some((e) => e.type === "tool-result")).toBe(true);
	const parts = (await messageStore.listWithParts(sessionId)).flatMap((g) => g.parts);
	expect(parts.some((p) => p.type === "tool-call")).toBe(true);
	expect(parts.some((p) => p.type === "tool-result")).toBe(true);
});
```
(Scripting the MockLanguageModelV3 to emit tool chunks + a `tool-calls` finish then a follow-up step requires the v6 mock tool-chunk shape from Step 1 — build the scripted chunks to match.)

- [ ] **Step 3: Run to verify it fails** — FAIL (no tools wired; `MAX_STEPS=1`).

- [ ] **Step 4: Implement**

In `runtime.ts`:
- Add `import { buildTools } from "../tool/registry";` and `import type { ToolDef } from "../tool/types";`, plus `import { experimental_repairToolCall } from "ai"` if it's a standalone export (else it's just an option — verify in Step 1).
- Replace `const MAX_STEPS = 1` with `const DEFAULT_MAX_STEPS = 50;`.
- `RunTurnInput` gains `tools?: ToolDef[]`.
- In the `streamText(...)` call (in `runAttempt`/`streamAssistant`): build the tools and pass them:
```ts
const tools = buildTools(toolDefs, { sessionId, messageId: assistantId, agentId: agent.id, abortSignal });
// ...
const result = streamText({
	model,
	messages,
	stopWhen: stepCountIs(DEFAULT_MAX_STEPS),
	tools,
	experimental_repairToolCall: async ({ toolCall, error, messages, system, tools: t }) => {
		// minimal repair: return null to let the SDK surface the error, or re-ask — verify the v6 contract in Step 1 and implement the minimal documented form.
		return null;
	},
	abortSignal,
	maxRetries: 0,
	...buildSettings(params),
});
```
  (Thread `toolDefs` / the per-attempt `assistantId` / `agent.id` into `streamAssistant`/`runAttempt` as params — they currently receive `model, messages, params, assistantId, abortSignal`; add `toolDefs` + `agentId`. Empty `toolDefs` → `buildTools([], ...)` → `{}` → identical to today.)
- In `drainStream`, add branches for the tool chunks (names per Step 1):
```ts
} else if (chunk.type === "tool-call") {
	await messageStore.appendPart({
		messageId: assistantId,
		type: "tool-call",
		content: { callId: chunk.toolCallId, toolName: chunk.toolName, args: chunk.input },
		status: "complete",
	});
	yield { type: "tool-call", callId: chunk.toolCallId, toolName: chunk.toolName, args: chunk.input };
} else if (chunk.type === "tool-result") {
	await messageStore.appendPart({
		messageId: assistantId,
		type: "tool-result",
		content: { callId: chunk.toolCallId, result: chunk.output, isError: false },
		status: "complete",
	});
	yield { type: "tool-result", callId: chunk.toolCallId, result: chunk.output, isError: false };
}
```
  (`drainStream` will need `messageStore` + `assistantId` in scope — pass them in. Persisting tool parts directly via `appendPart` (status complete) is fine; they aren't streamed deltas.)

- [ ] **Step 5: Run the tool test + full agent suite + typecheck** — PASS; existing tests unaffected (no `tools` → single step, no tool chunks).

- [ ] **Step 6: Commit**
```bash
pnpm dlx ultracite fix packages/agent/src/session
git add packages/agent/src/session/runtime.ts packages/agent/src/session/runtime.test.ts
git commit -m "feat(agent): multi-step tool loop with persisted tool parts"
```
(Include `runtime-tools.test.ts` in the add if you split it out.)

---

### Task 5: Replay tool parts as model messages (multi-turn history)

**Files:**
- Modify: `packages/agent/src/session/to-model-messages.ts`
- Modify: `packages/agent/src/session/to-model-messages.test.ts`

**Interfaces:**
- Produces: `toModelMessages` now emits, for an assistant entry containing `tool-call` parts, an assistant message whose `content` is an array of AI-SDK tool-call parts (alongside any text); and, for each `tool-result` part, a `{ role: "tool", content: [tool-result] }` message — so a later turn replays prior tool use correctly.

- [ ] **Step 1: Verify the AI-SDK assistant/tool `ModelMessage` content shapes**

From the installed `ai` types, confirm the exact shapes for: an assistant message carrying tool calls (`content: Array<{ type: "tool-call"; toolCallId; toolName; input }>` plus `{ type: "text"; text }`) and a tool message (`content: Array<{ type: "tool-result"; toolCallId; toolName; output: { type: "text"; value } }>`). Record exact field names; the code below uses the documented shapes — fix to match.

- [ ] **Step 2: Write the failing test**

Add to `to-model-messages.test.ts` a case: an assistant entry with a text part + a `tool-call` part, followed by a `tool-result` part, produces (in order) an assistant message with text + a tool-call content part, then a tool message with the matching tool-result. Assert the `toolCallId`s line up and the result value is carried.

- [ ] **Step 3: Run to verify it fails** — FAIL (tool parts currently ignored).

- [ ] **Step 4: Implement**

Rewrite the per-entry rendering in `to-model-messages.ts` so that, instead of `toTextContent` dropping tool parts, an assistant entry builds a content array from its `text`/`reasoning` parts (as text) and its `tool-call` parts (as AI-SDK tool-call content), and each `tool-result` part emits a following `{ role: "tool", content: [...] }` message. Keep the existing system-prompt + summary + `compactedThroughSeq` filtering unchanged. Map stored `tool-call` `{callId, toolName, args}` → `{ type: "tool-call", toolCallId: callId, toolName, input: args }`; stored `tool-result` `{callId, result}` → `{ type: "tool-result", toolCallId: callId, toolName: <from the matching call>, output: { type: "text", value: String(result) } }`. (If a function exceeds 50 lines, extract a `renderAssistantEntry` helper.)

- [ ] **Step 5: Run the test + full agent suite + typecheck** — PASS; the existing text/reasoning/summary tests still pass (assistant entries with only text still produce a plain string-or-text-content assistant message — keep that shape stable, or update those assertions if the content moves from `string` to an array uniformly; prefer keeping pure-text entries as `{ role, content: string }`).

- [ ] **Step 6: Commit**
```bash
pnpm dlx ultracite fix packages/agent/src/session/to-model-messages.ts packages/agent/src/session/to-model-messages.test.ts
git add packages/agent/src/session/to-model-messages.ts packages/agent/src/session/to-model-messages.test.ts
git commit -m "feat(agent): replay tool parts as model messages across turns"
```

---

## Final verification

- [ ] **Agent suite:** `pnpm -F @better-agent/agent test` — green (new: truncate, registry, runtime tool loop, tool-message replay).
- [ ] **Typecheck:** `pnpm -F @better-agent/agent exec tsc --noEmit`; `pnpm -F @better-agent/api exec tsc -b` (the new `RunEvent` variants flow through the api `streamTurn` passthrough — confirm it still typechecks; the api just forwards events). `pnpm -F server check-types`.
- [ ] **Lint:** `pnpm dlx ultracite check packages/agent/src/tool packages/agent/src/session` — clean.
- [ ] **Coverage:** T1 → Tasks 2,4,5; T4 → Task 1 (+ registry wrap); T7 → Task 4 (`experimental_repairToolCall`). In-process tools run end-to-end; the loop degrades to today's single-step behavior when no tools are passed.
- [ ] **Scope guard (by design, deferred to Plan B/C):** no remote tools / pending store / Redis / `submitToolResult` / client-SDK changes (Plan B); no prompt caching / token accounting (Plan C); truncation keeps output in memory (no overflow-to-file); `maxSteps`/`tools` not persisted on the agent (constant + `RunTurnInput`).
