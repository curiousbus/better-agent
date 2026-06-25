# Chat Tool Visibility + Error + Cancel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent tool-use visible in the web chat (render `tool-call`/`tool-result` from both history and the live stream), surface a real error message instead of a bare badge, and make the composer's Stop also cancel the server-side turn.

**Architecture:** The whole tool system already runs server-side and the client SDK already yields `tool-call`/`tool-result`/`error` stream events — the chat UI just drops them. We extend the UI's `ChatMessage` with an ordered `tools: ToolInvocation[]` and an `errorText`, populate them from history (`toChatMessage`) and the live stream (`use-chat`), and render them with a new flat collapsible `ToolInvocationView` (styled like the existing `Reasoning` disclosure). Text/reasoning keep streaming through the existing `stream-reveal` unchanged; tools render before the final answer text, matching the causal order (reason → call tools → answer). We add a `cancel(sessionId)` method to the client SDK and wire `stop()` to call it best-effort.

**Tech Stack:** TypeScript, React, `@base-ui/react/collapsible`, lucide-react, TanStack Query, the `@better-agent/client` SDK.

## Global Constraints

- Flat UI — no nested cards/heavy borders. Match the existing `Reasoning` disclosure look (`rounded-md border bg-muted/40 p-2`, muted xs text).
- Functions ≤50 lines, files ≤300 lines, no `any` (use `unknown` + narrowing), prefer `??` over `||`, `const` by default.
- Accessibility: disclosures keyboard-operable (base-ui Collapsible handles this); status conveyed by text/aria, not color alone.
- conventional-commits; commit footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit BARE (never pipe `git commit` through grep/head — SIGPIPE aborts the commit).
- Do not change `stream-reveal.ts` or the text/reasoning streaming behavior.
- Run `pnpm exec biome lint <changed files>` from the repo ROOT (not a subdir). The pre-commit hook also runs eslint `max-lines-per-function` (≤50) — biome does NOT enforce that, so keep components small.

---

### Task 1: Client SDK — `cancel(sessionId)` method

**Files:**
- Modify: `packages/client/src/index.ts` (interface + both factories)
- Test: `packages/client/src/index.test.ts`

**Interfaces:**
- Produces: `AgentClient.cancel(sessionId: string): Promise<void>` — used by `use-chat` `stop()` in Task 3.

- [ ] **Step 1: Write the failing test**

Add to `packages/client/src/index.test.ts` (follow the existing fake-`Client` pattern in that file — a stub object whose `sessions`/`userSessions` methods are spies). Test both factories:

```ts
it("cancel() calls userSessions.cancel for the user-session client", async () => {
	const calls: Array<{ sessionId: string }> = [];
	const fake = {
		userSessions: {
			cancel: (input: { sessionId: string }) => {
				calls.push(input);
				return Promise.resolve({ ok: true });
			},
		},
	} as unknown as Parameters<typeof createUserSessionClientFrom>[0];
	const sdk = createUserSessionClientFrom(fake, "agent-1");
	await sdk.cancel("sess-1");
	expect(calls).toEqual([{ sessionId: "sess-1" }]);
});

it("cancel() calls sessions.cancel for the agent-token client", async () => {
	const calls: Array<{ sessionId: string }> = [];
	const fake = {
		sessions: {
			cancel: (input: { sessionId: string }) => {
				calls.push(input);
				return Promise.resolve({ ok: true });
			},
		},
	} as unknown as Parameters<typeof createAgentClientFrom>[0];
	const sdk = createAgentClientFrom(fake);
	await sdk.cancel("sess-2");
	expect(calls).toEqual([{ sessionId: "sess-2" }]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @better-agent/client test`
Expected: FAIL — `sdk.cancel is not a function`.

- [ ] **Step 3: Add `cancel` to the interface and both factories**

In `packages/client/src/index.ts`, add to the `AgentClient` interface (after `stream`):

```ts
	/** 取消进行中的会话回合（服务端 cancellation）。 */
	cancel(sessionId: string): Promise<void>;
```

In `createAgentClientFrom`'s returned object add:

```ts
		async cancel(sessionId) {
			await client.sessions.cancel({ sessionId });
		},
```

In `createUserSessionClientFrom`'s returned object add:

```ts
		async cancel(sessionId) {
			await client.userSessions.cancel({ sessionId });
		},
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @better-agent/client test`
Expected: PASS (all client tests).

- [ ] **Step 5: Verify types + lint + commit**

```bash
pnpm check-types
pnpm exec biome lint packages/client/src/index.ts packages/client/src/index.test.ts
git add packages/client/src/index.ts packages/client/src/index.test.ts
git commit -m "$(printf 'feat(client): add cancel(sessionId) to agent client SDK\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: root tsc clean; client tests pass; lint clean.

---

### Task 2: ChatMessage tool model + history mapping

**Files:**
- Modify: `packages/ui/src/components/chat/use-chat.ts`
- Test: `packages/ui/src/components/chat/use-chat.test.ts` (create if absent; otherwise add cases)

**Interfaces:**
- Produces (consumed by Tasks 3 + 4):
```ts
export interface ToolInvocation {
	callId: string;
	toolName: string;
	args: unknown;
	result?: unknown;
	isError: boolean;
	status: "running" | "complete" | "error";
}
export interface ChatMessage {
	id: string;
	reasoning: string;
	role: "user" | "assistant" | "system";
	status: "complete" | "streaming" | "error";
	text: string;
	tools: ToolInvocation[];   // ordered by first appearance (call seq)
	errorText?: string;         // populated on the live error event (Task 3)
}
```

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/components/chat/use-chat.test.ts`. `toChatMessage` is module-private, so export it (add `export` to its declaration in Step 3) and import it here. The history row shape is `MessageHistory[number]` = `{ message: {...}, parts: MessagePart[] }`. Build a minimal fixture (cast through `unknown` to the row type — do NOT use `any`):

```ts
import { describe, expect, it } from "vitest";
import { toChatMessage } from "./use-chat";

function part(over: Record<string, unknown>) {
	return {
		id: "p", messageId: "m", seq: 0, status: "complete",
		createdAt: new Date(), updatedAt: new Date(), ...over,
	};
}

describe("toChatMessage", () => {
	it("pairs tool-call and tool-result parts by callId into tools[]", () => {
		const row = {
			message: { id: "m1", role: "assistant", status: "complete" },
			parts: [
				part({ type: "reasoning", content: { text: "think" } }),
				part({ type: "tool-call", seq: 1, content: { callId: "c1", toolName: "search", args: { q: "x" } } }),
				part({ type: "tool-result", seq: 2, content: { callId: "c1", result: { hits: 3 }, isError: false } }),
				part({ type: "text", seq: 3, content: { text: "done" } }),
			],
		} as unknown as Parameters<typeof toChatMessage>[0];
		const msg = toChatMessage(row);
		expect(msg.text).toBe("done");
		expect(msg.reasoning).toBe("think");
		expect(msg.tools).toHaveLength(1);
		expect(msg.tools[0]).toMatchObject({
			callId: "c1", toolName: "search", isError: false, status: "complete",
		});
		expect(msg.tools[0]?.result).toEqual({ hits: 3 });
	});

	it("marks a tool-call without a result as running", () => {
		const row = {
			message: { id: "m2", role: "assistant", status: "streaming" },
			parts: [
				part({ type: "tool-call", content: { callId: "c9", toolName: "fetch", args: {} } }),
			],
		} as unknown as Parameters<typeof toChatMessage>[0];
		const msg = toChatMessage(row);
		expect(msg.tools[0]).toMatchObject({ callId: "c9", status: "running" });
	});

	it("marks an errored tool-result as status error", () => {
		const row = {
			message: { id: "m3", role: "assistant", status: "complete" },
			parts: [
				part({ type: "tool-call", content: { callId: "c2", toolName: "x", args: {} } }),
				part({ type: "tool-result", seq: 1, content: { callId: "c2", result: "boom", isError: true } }),
			],
		} as unknown as Parameters<typeof toChatMessage>[0];
		const msg = toChatMessage(row);
		expect(msg.tools[0]).toMatchObject({ status: "error", isError: true });
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @better-agent/ui test use-chat`
Expected: FAIL — `tools` undefined / `toChatMessage` not exported.

- [ ] **Step 3: Implement the model + mapping**

In `packages/ui/src/components/chat/use-chat.ts`:

1. Add the `ToolInvocation` interface (exported) and extend `ChatMessage` with `tools: ToolInvocation[]` and `errorText?: string` (see Interfaces above).
2. Add `export` to `toChatMessage`.
3. Rewrite `toChatMessage` to build tools. Iterate parts in array order (history is already seq-ordered); collect text/reasoning as today, and:

```ts
function buildTools(parts: SessionMessageRow["parts"]): ToolInvocation[] {
	const byId = new Map<string, ToolInvocation>();
	const order: string[] = [];
	for (const part of parts) {
		if (part.type === "tool-call") {
			const c = part.content;
			byId.set(c.callId, {
				callId: c.callId, toolName: c.toolName, args: c.args,
				isError: false, status: "running",
			});
			order.push(c.callId);
		} else if (part.type === "tool-result") {
			const c = part.content;
			const inv = byId.get(c.callId);
			if (inv) {
				inv.result = c.result;
				inv.isError = c.isError;
				inv.status = c.isError ? "error" : "complete";
			}
		}
	}
	return order.map((id) => byId.get(id)).filter((x): x is ToolInvocation => x !== undefined);
}
```

   Then in `toChatMessage` set `tools: buildTools(entry.parts)`. Keep the existing text/reasoning loop (it ignores tool parts harmlessly).
4. Update the two draft `ChatMessage` literals in `sendMessage` (user + assistant) to include `tools: []` so they typecheck. Leave `errorText` unset.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @better-agent/ui test use-chat`
Expected: PASS.

- [ ] **Step 5: Verify types + lint + commit**

```bash
pnpm check-types
pnpm exec biome lint packages/ui/src/components/chat/use-chat.ts packages/ui/src/components/chat/use-chat.test.ts
git add packages/ui/src/components/chat/use-chat.ts packages/ui/src/components/chat/use-chat.test.ts
git commit -m "$(printf 'feat(ui): model tool invocations in ChatMessage from history\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: root tsc clean; ui tests pass; lint clean.

---

### Task 3: Live streaming of tool events + cancel wiring

**Files:**
- Modify: `packages/ui/src/components/chat/use-chat.ts`
- Test: `packages/ui/src/components/chat/use-chat.test.ts`

**Interfaces:**
- Consumes: `ToolInvocation`/`ChatMessage` from Task 2; `AgentClient.cancel` from Task 1.
- Stream event union `RunEvent` includes (from the server): `{type:"tool-call", callId, toolName, args}`, `{type:"tool-result", callId, result, isError}`, `{type:"error", message}`, `{type:"text-delta", delta}`, `{type:"reasoning-delta", delta}`.

- [ ] **Step 1: Write the failing test**

Add to `use-chat.test.ts`. Test `streamPrompt` directly (export it in Step 3) with a fake `agentClient.stream` async-generator and a `setDraft` spy. Assert the final draft assistant carries the paired tool + the error text:

```ts
import { streamPrompt } from "./use-chat";

function fakeStream(events: unknown[]) {
	return {
		// biome-ignore lint/suspicious/useAwait: test async generator
		async *stream() { for (const e of events) yield e; },
	} as unknown as import("@better-agent/client").AgentClient;
}

it("streams tool-call then tool-result into the draft assistant", async () => {
	const drafts: ChatMessage[][] = [];
	const user: ChatMessage = { id: "u", role: "user", text: "hi", reasoning: "", status: "complete", tools: [] };
	const assistant: ChatMessage = { id: "a", role: "assistant", text: "", reasoning: "", status: "streaming", tools: [] };
	await streamPrompt({
		agentClient: fakeStream([
			{ type: "tool-call", callId: "c1", toolName: "search", args: { q: "x" } },
			{ type: "tool-result", callId: "c1", result: "ok", isError: false },
			{ type: "text-delta", delta: "answer" },
		]),
		assistant, user, sessionId: "s", text: "hi",
		signal: new AbortController().signal,
		setDraft: (m) => drafts.push(m),
	});
	const last = drafts.at(-1)?.[1];
	expect(last?.tools).toHaveLength(1);
	expect(last?.tools[0]).toMatchObject({ callId: "c1", status: "complete" });
});

it("captures the error event message as errorText", async () => {
	const drafts: ChatMessage[][] = [];
	const user: ChatMessage = { id: "u", role: "user", text: "hi", reasoning: "", status: "complete", tools: [] };
	const assistant: ChatMessage = { id: "a", role: "assistant", text: "", reasoning: "", status: "streaming", tools: [] };
	await streamPrompt({
		agentClient: fakeStream([{ type: "error", message: "rate limited" }]),
		assistant, user, sessionId: "s", text: "hi",
		signal: new AbortController().signal,
		setDraft: (m) => drafts.push(m),
	});
	const last = drafts.at(-1)?.[1];
	expect(last?.status).toBe("error");
	expect(last?.errorText).toBe("rate limited");
});
```

Note: the reveal loop emits frames on animation frames; in jsdom the fallback `setTimeout` path runs. `reveal.flush()` is called at the end of `streamPrompt`, which forces a final synchronous `onFrame`, so the last draft reflects the streamed text. If a timing flake appears, assert on `assistant.tools`/`assistant.errorText` (mutated in place) instead of the draft array.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @better-agent/ui test use-chat`
Expected: FAIL — tool events ignored; `errorText` undefined.

- [ ] **Step 3: Implement streaming tool handling + cancel**

In `use-chat.ts`:

1. `export` `streamPrompt`.
2. In `streamPrompt`'s `for await` loop, after the existing `text-delta`/`reasoning-delta` branches, add:

```ts
} else if (event.type === "tool-call") {
	assistant.tools = [
		...assistant.tools,
		{ callId: event.callId, toolName: event.toolName, args: event.args, isError: false, status: "running" },
	];
	setDraft([user, { ...assistant }]);
} else if (event.type === "tool-result") {
	assistant.tools = assistant.tools.map((t) =>
		t.callId === event.callId
			? { ...t, result: event.result, isError: event.isError, status: event.isError ? "error" : "complete" }
			: t
	);
	setDraft([user, { ...assistant }]);
}
```

   In the existing `error` branch, also capture the message: `assistant.status = "error"; assistant.errorText = event.message;`.
   (The reveal `onFrame` callback still re-emits `text`/`reasoning`; tool/error updates push their own `setDraft` with the latest `assistant` snapshot — keep spreading `{ ...assistant }` so React sees a new object. The reveal frames spread `assistant` too; ensure the reveal `onFrame` includes `tools`/`errorText` by spreading `...assistant` there — verify the existing `onFrame` does `{ ...assistant, text, reasoning }`; if it lists fields explicitly, add `tools: assistant.tools, errorText: assistant.errorText`.)
3. Wire cancel in `useChat`'s `stop`:

```ts
const stop = () => {
	abortRef.current?.abort();
	if (sessionId !== "") {
		agentClient.cancel(sessionId).catch(() => undefined);
	}
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @better-agent/ui test use-chat`
Expected: PASS.

- [ ] **Step 5: Verify types + lint + commit**

```bash
pnpm check-types
pnpm exec biome lint packages/ui/src/components/chat/use-chat.ts packages/ui/src/components/chat/use-chat.test.ts
git add packages/ui/src/components/chat/use-chat.ts packages/ui/src/components/chat/use-chat.test.ts
git commit -m "$(printf 'feat(ui): stream tool events into chat and cancel on stop\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: root tsc clean; ui tests pass; lint clean.

---

### Task 4: Tool disclosure UI + error block + conversation render

**Files:**
- Create: `packages/ui/src/components/chat/tool.tsx`
- Modify: `packages/ui/src/components/chat/conversation.tsx`

**Interfaces:**
- Consumes: `ToolInvocation`, `ChatMessage` (with `tools`, `errorText`) from Tasks 2/3.

- [ ] **Step 1: Create the tool disclosure component**

`packages/ui/src/components/chat/tool.tsx` — mirror the `Reasoning` disclosure style (`@base-ui/react/collapsible`, flat `rounded-md border bg-muted/40 p-2`, muted xs text). One collapsible per invocation; trigger shows a wrench icon + tool name + a status indicator; panel shows args and result as pretty JSON, truncated. Keep each function ≤50 lines (extract a `statusIcon` helper and a `formatValue` helper). No `any`.

```tsx
import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "@better-agent/ui/lib/utils";
import { CheckIcon, ChevronDownIcon, Loader2Icon, WrenchIcon, XIcon } from "lucide-react";
import type { ToolInvocation } from "./use-chat";

const MAX_VALUE_CHARS = 2000;

function formatValue(value: unknown): string {
	if (value === undefined) {
		return "";
	}
	let text: string;
	if (typeof value === "string") {
		text = value;
	} else {
		try {
			text = JSON.stringify(value, null, 2);
		} catch {
			text = String(value);
		}
	}
	return text.length > MAX_VALUE_CHARS
		? `${text.slice(0, MAX_VALUE_CHARS)}\n…(truncated)`
		: text;
}

function StatusIcon({ status }: { status: ToolInvocation["status"] }) {
	if (status === "running") {
		return <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />;
	}
	if (status === "error") {
		return <XIcon className="size-3.5 text-destructive" />;
	}
	return <CheckIcon className="size-3.5 text-muted-foreground" />;
}

function ToolInvocationView({ tool }: { tool: ToolInvocation }) {
	return (
		<Collapsible.Root
			className={cn(
				"rounded-md border bg-muted/40 p-2",
				tool.isError && "border-destructive/40"
			)}
		>
			<Collapsible.Trigger className="flex w-full items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground">
				<WrenchIcon className="size-3.5" />
				<span className="font-mono">{tool.toolName}</span>
				<StatusIcon status={tool.status} />
				<ChevronDownIcon className="ml-auto size-3.5 transition-transform data-[panel-open]:rotate-180" />
			</Collapsible.Trigger>
			<Collapsible.Panel className="mt-2 flex flex-col gap-2">
				<ToolSection label="Arguments" value={formatValue(tool.args)} />
				{tool.status === "running" ? null : (
					<ToolSection label="Result" value={formatValue(tool.result)} />
				)}
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}

function ToolSection({ label, value }: { label: string; value: string }) {
	if (value === "") {
		return null;
	}
	return (
		<div className="flex flex-col gap-1">
			<span className="text-[10px] text-muted-foreground uppercase tracking-wide">
				{label}
			</span>
			<pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-muted-foreground text-xs">
				{value}
			</pre>
		</div>
	);
}

export function ToolGroup({ tools }: { tools: ToolInvocation[] }) {
	if (tools.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-2">
			{tools.map((tool) => (
				<ToolInvocationView key={tool.callId} tool={tool} />
			))}
		</div>
	);
}
```

- [ ] **Step 2: Render tools + error block in `AssistantBody`**

In `conversation.tsx`:
- Import `ToolGroup` from `./tool`, and add an error icon import (`TriangleAlertIcon` from lucide-react).
- In `AssistantBody`, render order: reasoning (existing) → `<ToolGroup tools={message.tools} />` → response/loader (existing).
- Replace the bare error badge:

```tsx
{message.status === "error" ? (
	<div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive text-sm">
		<TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
		<span>{message.errorText ?? "Something went wrong. Please try again."}</span>
	</div>
) : null}
```
   Remove the now-unused `Badge` import if nothing else uses it. The streaming-empty `Loader` should still show only when `text === ""` AND there are no tools yet — change the condition to `streamingEmpty && message.tools.length === 0` so the loader doesn't sit above a running tool.

- [ ] **Step 3: Verify build + types + lint**

```bash
pnpm -F web build
pnpm check-types
pnpm exec biome lint packages/ui/src/components/chat/tool.tsx packages/ui/src/components/chat/conversation.tsx
```
Expected: web build clean; root tsc clean; lint clean. (No unit test for pure presentational components; the build + types are the gate. Per memory, do NOT drive a browser — leave visual verification to the user.)

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/chat/tool.tsx packages/ui/src/components/chat/conversation.tsx
git commit -m "$(printf 'feat(ui): render tool calls and error details in the conversation\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review Notes
- Coverage: SDK cancel (T1); ChatMessage tool model + history pairing (T2); live tool/error streaming + stop→cancel (T3); tool disclosure UI + error block + render order (T4).
- Type consistency: `ToolInvocation` defined once in `use-chat.ts`, consumed by `tool.tsx` and `conversation.tsx`; `cancel(sessionId)` added to the `AgentClient` interface and both factories, called by `useChat.stop`.
- YAGNI: tools render as a group before the final text (causal order) rather than fully interleaved between text segments — the `stream-reveal` text/reasoning model is left untouched; full interleave is a deliberate later enhancement. No token/cost UI in this pass. No retry button (error text only) — can follow later.
- Security/robustness: tool result/args are stringified defensively and truncated to `MAX_VALUE_CHARS`; cancel is best-effort (`.catch`), never blocks the local abort.
