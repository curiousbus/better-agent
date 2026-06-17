# Plan 3b：Session 运行时（runTurn 流式循环 + sessions 路由）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 3a 的会话数据层之上，实现**有状态、流式**的对话运行时：`runTurn` 用 AI SDK `streamText` 跑一轮、把 user/assistant 消息与 text/reasoning parts 增量落库、并 `yield` 客户端事件；再通过 oRPC `sessions` 路由暴露 `create/get/list/listMessages/run/prompt`（`prompt` 为流式 event iterator，`run` 返回最终消息），最后在 `apps/server` 组装注入。

**Architecture:** 沿用「隔离运行时 + 依赖注入」。`packages/agent` 新增纯运行时 `session/runtime.ts`（依赖 3a 的 `SessionStore`/`MessageStore`/`AgentStore` ports + 既有 `ModelFactory`，调用纯函数 `toModelMessages`），事件类型 `session/events.ts`，AI-SDK→领域映射 `session/stream-mapping.ts`；`packages/api` 新增 `sessions` 路由并把运行时与两个 store 注入 `AgentServices`；`apps/server` 组装。运行时**单测**靠注入 fake stores + AI SDK `MockLanguageModelV3` 脚本化流，无需真实模型/DB。详见 `docs/superpowers/specs/2026-06-16-agent-runtime-design.md` 第 7–8 节、第 11 节 `sessions`。

**Tech Stack:** TypeScript(ESM, strict) · Vitest · AI SDK `ai`(6.0.205) + `ai/test`（`MockLanguageModelV3`/`simulateReadableStream`） · oRPC(1.14.6, async-generator handler = event iterator) · Zod。**不新增依赖**（`ai`/`@ai-sdk/provider` 已在 `packages/agent`）。

## Global Constraints

- 每个 commit 前先跑 `pnpm fix`（biome）再提交；禁 `^`/`~`/`latest`，装包用 `pnpm add -E`（本计划不装包）。
- 文件名 kebab-case；**函数 ≤50 行、圈复杂度 ≤10**（仓库 ESLint `max-lines-per-function: 50` 会在 pre-commit 拦截——如某函数超限，抽顶层 helper，逻辑不变，别塞进单个函数）；禁 `any`/`console`；魔法数字抽具名常量；优先 `for...of`；`const` 默认。
- `packages/agent` **不得 import `packages/db`**；只用 ports。
- **运行时已验证的流事实**（来自对 `ai@6.0.205` 的实测，实现/测试按此为准）：
  - `streamText({ model, messages, stopWhen, tools: {} })` 的 `fullStream` 在正常一轮里依次产出：`start` → `start-step` → `text-start` → `text-delta`(n 次，字段 `.text`) → `text-end` → `finish-step` → `finish`。
  - `finish` chunk：`.totalUsage`（**扁平** `{ inputTokens, outputTokens, totalTokens }`，均 `number | undefined`）、`.finishReason`（**字符串**联合 `'stop'|'length'|'content-filter'|'tool-calls'|'error'|'other'`）。
  - `reasoning-delta` chunk 字段为 `.text`。`finish-step` 表示一步结束。
  - 错误注入：**`doStream` 直接 reject** → `fullStream` 产出 `{ type: "error", error }` chunk 且**不抛**（循环正常结束、无 `finish`）。注意 provider 流里中途塞 `error` chunk 会被 streamText 吞掉、**不可靠**——测试用 reject。
  - `messages` 里含 `system` 角色消息可直接传（无需 `allowSystemInMessages`）。
  - oRPC handler 入参含 `signal?: AbortSignal`，async-generator handler 即流式 event iterator。
- **范围**：本计划交付 P1 对话运行时（无工具 → 单步）。**不做**：工具/tool-* 事件与 parts 映射（📐 P2）、上下文压缩触发（📐 P2，仅 `toModelMessages` 摘要分支已就位）、Permission 网关接线（spec §12，留待）、Client SDK（Plan 4）、admin（Plan 5）。**落库节流**：本期文本累积在内存、`finally` 一次性落 part（spec §8「或 finish 时落库」允许）；时间窗（~200ms）中途 `updatePart` 节流 = 后续优化，不做。**abort**：代码处理（`abort` chunk + catch `AbortError` → 消息标 `aborted`、已累积文本在 `finally` 落库保留），但因计时不确定，**不写脆弱的单测**，由 Task 5 手动 e2e（客户端断开）验证，已在范围内注明。

---

## 文件结构

**Create:**
- `packages/agent/src/session/events.ts` — `RunEvent` 客户端事件联合
- `packages/agent/src/session/stream-mapping.ts` — `mapFinishReason` / `mapUsage`（AI-SDK → 领域）
- `packages/agent/src/session/stream-mapping.test.ts`
- `packages/agent/src/session/runtime.ts` — `createSessionRuntime(deps).runTurn(...)`
- `packages/agent/src/session/runtime.test.ts`
- `packages/api/src/routers/sessions.ts` — oRPC `sessions` 路由
- `packages/api/src/routers/sessions.test.ts`

**Modify:**
- `packages/agent/src/testing/fakes.ts` — 增 `createFakeAgentStore` / `createFakeSessionStore` / `createFakeMessageStore`
- `packages/api/src/services.ts` — `AgentServices` 增 `runtime` 与 `stores.session`/`stores.message`
- `packages/api/src/routers/index.ts` — 挂载 `sessions`
- `apps/server/src/index.ts` — 组装 sessionStore/messageStore/runtime 注入

---

## Task 1: 事件类型 + AI-SDK→领域映射（纯）

**Files:**
- Create: `packages/agent/src/session/events.ts`, `packages/agent/src/session/stream-mapping.ts`
- Test: `packages/agent/src/session/stream-mapping.test.ts`

**Interfaces:**
- Produces: `events.ts` 导出 `RunEvent`；`stream-mapping.ts` 导出 `mapFinishReason(reason): FinishReason`、`mapUsage(usage): MessageUsage`。Task 3 的 runtime 消费它们。

- [ ] **Step 1: 写 `packages/agent/src/session/events.ts`（无逻辑、无测试）**

```ts
import type { FinishReason, MessageUsage } from "./types";

/** runTurn 向客户端 yield 的事件。tool-call/tool-result 事件 📐 留待工具阶段。 */
export type RunEvent =
	| { type: "message-start"; messageId: string }
	| { type: "text-delta"; delta: string }
	| { type: "reasoning-delta"; delta: string }
	| { type: "step-finish" }
	| { type: "done"; usage: MessageUsage | null; finishReason: FinishReason }
	| { type: "error"; message: string };
```

- [ ] **Step 2: 写失败测试 `stream-mapping.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { mapFinishReason, mapUsage } from "./stream-mapping";

describe("mapFinishReason", () => {
	it("passes through the four domain reasons", () => {
		expect(mapFinishReason("stop")).toBe("stop");
		expect(mapFinishReason("length")).toBe("length");
		expect(mapFinishReason("tool-calls")).toBe("tool-calls");
		expect(mapFinishReason("error")).toBe("error");
	});

	it("maps content-filter to error and other to stop", () => {
		expect(mapFinishReason("content-filter")).toBe("error");
		expect(mapFinishReason("other")).toBe("stop");
	});
});

describe("mapUsage", () => {
	it("copies token counts", () => {
		expect(
			mapUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
		).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
	});

	it("maps undefined token counts to null", () => {
		expect(
			mapUsage({
				inputTokens: undefined,
				outputTokens: undefined,
				totalTokens: undefined,
			})
		).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null });
	});
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `pnpm -F @better-agent/agent test src/session/stream-mapping.test.ts`
Expected: FAIL（`mapFinishReason`/`mapUsage` 未定义）。

- [ ] **Step 4: 实现 `stream-mapping.ts`**

```ts
import type { FinishReason as AiFinishReason, LanguageModelUsage } from "ai";
import type { FinishReason, MessageUsage } from "./types";

/** 只读 totalUsage 的三字段；完整 LanguageModelUsage 可结构赋值到此。 */
type UsageInput = Pick<
	LanguageModelUsage,
	"inputTokens" | "outputTokens" | "totalTokens"
>;

export function mapFinishReason(reason: AiFinishReason): FinishReason {
	switch (reason) {
		case "stop":
		case "length":
		case "tool-calls":
		case "error":
			return reason;
		case "content-filter":
			return "error";
		default:
			return "stop";
	}
}

export function mapUsage(usage: UsageInput): MessageUsage {
	return {
		inputTokens: usage.inputTokens ?? null,
		outputTokens: usage.outputTokens ?? null,
		totalTokens: usage.totalTokens ?? null,
	};
}
```

- [ ] **Step 5: 运行测试，确认通过 + 类型校验 + 提交**

Run: `pnpm -F @better-agent/agent test src/session/stream-mapping.test.ts`
Expected: PASS（4 用例）。
Run: `pnpm -F @better-agent/agent check-types`
Expected: 通过。
```bash
pnpm fix
git add packages/agent/src/session/events.ts packages/agent/src/session/stream-mapping.ts packages/agent/src/session/stream-mapping.test.ts
git commit -m "feat(agent): add run-event types and AI-SDK stream mapping"
```

---

## Task 2: fake stores（agent/session/message）

> 运行时单测需注入内存 fake stores（`packages/agent` 无 DB 依赖，不能用 pglite）。这些 fake 忠实实现 3a 的 port 语义（会话内/消息内 seq 从 0 递增、`listWithParts` 按 seq 升序分组），由 Task 3/4 的测试间接校验（沿用现有 provider fakes 无独立测试的约定）。

**Files:**
- Modify: `packages/agent/src/testing/fakes.ts`

**Interfaces:**
- Consumes: `AgentStore`/`SessionStore`/`MessageStore` ports（3a）；`AgentConfig`/`AgentInput`（`agent/types`）；`Session`/`Message`/`MessagePart`（`session/types`）。
- Produces: `createFakeAgentStore(seed?)`、`createFakeSessionStore()`、`createFakeMessageStore()`。

- [ ] **Step 1: 在 `packages/agent/src/testing/fakes.ts` 顶部 import 区追加**

```ts
import type { AgentConfig, AgentInput } from "../agent/types";
import type { AgentStore, MessageStore, SessionStore } from "../ports";
import type { Message, MessagePart, Session } from "../session/types";
```
> 注意：文件已 import `ModelCacheStore`/`ProviderCatalogStore`/`ProviderCredentialStore` 等；把上面三行合并进现有 import 区即可（`AgentStore`/`MessageStore`/`SessionStore` 加进已有的 `from "../ports"` 那条）。

- [ ] **Step 2: 在文件末尾追加三个 fake**

```ts
export function createFakeAgentStore(seed: AgentConfig[] = []): AgentStore {
	const map = new Map(seed.map((agent) => [agent.id, agent]));
	let counter = 0;
	return {
		create(input: AgentInput) {
			const now = new Date();
			counter += 1;
			const agent: AgentConfig = {
				id: `agent-${counter}`,
				...input,
				createdAt: now,
				updatedAt: now,
			};
			map.set(agent.id, agent);
			return Promise.resolve(agent);
		},
		get(id) {
			return Promise.resolve(map.get(id) ?? null);
		},
		list() {
			return Promise.resolve([...map.values()]);
		},
		update(id, input) {
			const existing = map.get(id);
			if (!existing) {
				return Promise.resolve(null);
			}
			const updated: AgentConfig = { ...existing, ...input, updatedAt: new Date() };
			map.set(id, updated);
			return Promise.resolve(updated);
		},
		delete(id) {
			map.delete(id);
			return Promise.resolve();
		},
	};
}

export function createFakeSessionStore(): SessionStore {
	const map = new Map<string, Session>();
	let counter = 0;
	return {
		create(input) {
			const now = new Date();
			counter += 1;
			const session: Session = {
				id: `session-${counter}`,
				agentId: input.agentId,
				title: null,
				status: "active",
				summary: null,
				compactedThroughSeq: null,
				createdAt: now,
				updatedAt: now,
			};
			map.set(session.id, session);
			return Promise.resolve(session);
		},
		get(id) {
			return Promise.resolve(map.get(id) ?? null);
		},
		list() {
			return Promise.resolve([...map.values()]);
		},
		setStatus(id, status) {
			const session = map.get(id);
			if (session) {
				session.status = status;
				session.updatedAt = new Date();
			}
			return Promise.resolve();
		},
		setTitle(id, title) {
			const session = map.get(id);
			if (session) {
				session.title = title;
				session.updatedAt = new Date();
			}
			return Promise.resolve();
		},
		setSummary(id, summary, compactedThroughSeq) {
			const session = map.get(id);
			if (session) {
				session.summary = summary;
				session.compactedThroughSeq = compactedThroughSeq;
				session.updatedAt = new Date();
			}
			return Promise.resolve();
		},
	};
}

export function createFakeMessageStore(): MessageStore {
	const messages: Message[] = [];
	const parts: MessagePart[] = [];
	let messageCounter = 0;
	let partCounter = 0;
	return {
		createMessage(input) {
			const now = new Date();
			messageCounter += 1;
			const seq = messages.filter((m) => m.sessionId === input.sessionId).length;
			const message: Message = {
				id: `message-${messageCounter}`,
				sessionId: input.sessionId,
				role: input.role,
				seq,
				status: input.status,
				providerId: input.providerId,
				modelId: input.modelId,
				usage: null,
				finishReason: null,
				error: null,
				createdAt: now,
				updatedAt: now,
			};
			messages.push(message);
			return Promise.resolve(message);
		},
		updateMessage(id, patch) {
			const message = messages.find((m) => m.id === id);
			if (!message) {
				return Promise.resolve(null);
			}
			Object.assign(message, patch, { updatedAt: new Date() });
			return Promise.resolve(message);
		},
		appendPart(input) {
			const now = new Date();
			partCounter += 1;
			const seq = parts.filter((p) => p.messageId === input.messageId).length;
			// type 与 content 在领域里关联、入参分两字段，构造时一次断言（同 db 边界）。
			const part = {
				id: `part-${partCounter}`,
				messageId: input.messageId,
				seq,
				type: input.type,
				content: input.content,
				status: input.status,
				createdAt: now,
				updatedAt: now,
			} as MessagePart;
			parts.push(part);
			return Promise.resolve(part);
		},
		updatePart(id, patch) {
			const part = parts.find((p) => p.id === id);
			if (!part) {
				return Promise.resolve(null);
			}
			Object.assign(part, patch, { updatedAt: new Date() });
			return Promise.resolve(part);
		},
		listWithParts(sessionId) {
			const result = messages
				.filter((message) => message.sessionId === sessionId)
				.sort((a, b) => a.seq - b.seq)
				.map((message) => ({
					message,
					parts: parts
						.filter((part) => part.messageId === message.id)
						.sort((a, b) => a.seq - b.seq),
				}));
			return Promise.resolve(result);
		},
	};
}
```

- [ ] **Step 3: 类型校验 + 提交**

Run: `pnpm -F @better-agent/agent check-types`
Expected: 通过。
```bash
pnpm fix
git add packages/agent/src/testing/fakes.ts
git commit -m "test(agent): add in-memory fakes for agent/session/message stores"
```

---

## Task 3: 运行时 `runTurn`（流式循环 + 增量落库）

**Files:**
- Create: `packages/agent/src/session/runtime.ts`
- Test: `packages/agent/src/session/runtime.test.ts`

**Interfaces:**
- Consumes: `SessionStore`/`MessageStore`/`AgentStore` ports、`ModelFactory`（`provider/model-factory`）、`toModelMessages`（`session/to-model-messages`）、`mapUsage`/`mapFinishReason`（Task 1）、`RunEvent`（Task 1）、`streamText`/`stepCountIs`（`ai`）；测试用 Task 2 fakes + `MockLanguageModelV3`/`simulateReadableStream`（`ai/test`）。
- Produces: `createSessionRuntime(deps): SessionRuntime`，其中 `runTurn(input): AsyncGenerator<RunEvent, Message>`（**yield** 事件、**return** 最终 assistant `Message`）。Task 4 的 `run`/`prompt` 消费它。

- [ ] **Step 1: 写失败测试 `runtime.test.ts`**

```ts
import type { LanguageModelV3, LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { expect, it } from "vitest";
import type { ModelFactory } from "../provider/model-factory";
import {
	createFakeAgentStore,
	createFakeMessageStore,
	createFakeSessionStore,
} from "../testing/fakes";
import type { RunEvent } from "./events";
import { createSessionRuntime } from "./runtime";
import type { Message } from "./types";

function v3Usage(input: number, output: number) {
	return {
		inputTokens: {
			total: input,
			noCache: undefined,
			cacheRead: undefined,
			cacheWrite: undefined,
		},
		outputTokens: { total: output, text: undefined, reasoning: undefined },
	};
}

function scriptedModel(chunks: LanguageModelV3StreamPart[]): LanguageModelV3 {
	return new MockLanguageModelV3({
		doStream: () => Promise.resolve({ stream: simulateReadableStream({ chunks }) }),
	});
}

function rejectingModel(message: string): LanguageModelV3 {
	return new MockLanguageModelV3({
		doStream: () => Promise.reject(new Error(message)),
	});
}

function fakeModelFactory(model: LanguageModelV3): ModelFactory {
	return { create: () => Promise.resolve(model) };
}

const HAPPY: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "Hello" },
	{ type: "text-delta", id: "0", delta: " world" },
	{ type: "text-end", id: "0" },
	{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: v3Usage(10, 5) },
];

const REASONING: LanguageModelV3StreamPart[] = [
	{ type: "reasoning-start", id: "r" },
	{ type: "reasoning-delta", id: "r", delta: "thinking" },
	{ type: "reasoning-end", id: "r" },
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "answer" },
	{ type: "text-end", id: "0" },
	{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: v3Usage(1, 1) },
];

async function setup(model: LanguageModelV3) {
	const agentStore = createFakeAgentStore();
	const sessionStore = createFakeSessionStore();
	const messageStore = createFakeMessageStore();
	const agent = await agentStore.create({
		name: "Helper",
		description: "d",
		systemPrompt: "You are helpful.",
		providerId: "openai",
		modelId: "gpt-x",
		params: null,
	});
	const session = await sessionStore.create({ agentId: agent.id });
	const runtime = createSessionRuntime({
		sessionStore,
		messageStore,
		agentStore,
		modelFactory: fakeModelFactory(model),
	});
	return { runtime, sessionStore, messageStore, session };
}

async function collect(gen: AsyncGenerator<RunEvent, Message>) {
	const events: RunEvent[] = [];
	let next = await gen.next();
	while (!next.done) {
		events.push(next.value);
		next = await gen.next();
	}
	return { events, final: next.value };
}

it("streams text and persists a complete assistant message", async () => {
	const { runtime, messageStore, session } = await setup(scriptedModel(HAPPY));
	const { events, final } = await collect(
		runtime.runTurn({ sessionId: session.id, text: "hi" })
	);
	expect(events.some((e) => e.type === "message-start")).toBe(true);
	const streamed = events
		.flatMap((e) => (e.type === "text-delta" ? [e.delta] : []))
		.join("");
	expect(streamed).toBe("Hello world");
	expect(events.find((e) => e.type === "done")).toEqual({
		type: "done",
		usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
		finishReason: "stop",
	});

	const history = await messageStore.listWithParts(session.id);
	expect(history.map((h) => h.message.role)).toEqual(["user", "assistant"]);
	expect(history[0]?.parts[0]?.content).toEqual({ text: "hi" });
	const assistant = history[1];
	expect(assistant?.message.status).toBe("complete");
	expect(assistant?.message.finishReason).toBe("stop");
	expect(assistant?.message.usage).toEqual({
		inputTokens: 10,
		outputTokens: 5,
		totalTokens: 15,
	});
	expect(assistant?.parts[0]?.content).toEqual({ text: "Hello world" });
	expect(final.status).toBe("complete");
	expect(final.role).toBe("assistant");
});

it("persists reasoning and text as separate ordered parts", async () => {
	const { runtime, messageStore, session } = await setup(scriptedModel(REASONING));
	const { events } = await collect(
		runtime.runTurn({ sessionId: session.id, text: "hi" })
	);
	expect(events.some((e) => e.type === "reasoning-delta")).toBe(true);
	const assistant = (await messageStore.listWithParts(session.id))[1];
	expect(assistant?.parts.map((p) => p.type)).toEqual(["reasoning", "text"]);
	expect(assistant?.parts[0]?.content).toEqual({ text: "thinking" });
	expect(assistant?.parts[1]?.content).toEqual({ text: "answer" });
});

it("marks the assistant and session as error when the model fails", async () => {
	const { runtime, sessionStore, messageStore, session } = await setup(
		rejectingModel("boom")
	);
	const { events, final } = await collect(
		runtime.runTurn({ sessionId: session.id, text: "hi" })
	);
	expect(events.some((e) => e.type === "error")).toBe(true);
	expect(final.status).toBe("error");
	expect((await sessionStore.get(session.id))?.status).toBe("error");
	const assistant = (await messageStore.listWithParts(session.id))[1];
	expect(assistant?.message.status).toBe("error");
});

it("throws when the session does not exist", async () => {
	const { runtime } = await setup(scriptedModel(HAPPY));
	await expect(
		runtime.runTurn({ sessionId: "missing", text: "hi" }).next()
	).rejects.toThrow(/not found/i);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm -F @better-agent/agent test src/session/runtime.test.ts`
Expected: FAIL（`createSessionRuntime` 未定义）。

- [ ] **Step 3: 实现 `runtime.ts`**

```ts
import { stepCountIs, streamText } from "ai";
import type { ModelMessage } from "ai";
import type { AgentParams } from "../agent/types";
import type { AgentStore, MessageStore, SessionStore } from "../ports";
import type { ModelFactory } from "../provider/model-factory";
import type { RunEvent } from "./events";
import { mapFinishReason, mapUsage } from "./stream-mapping";
import { toModelMessages } from "./to-model-messages";
import type { AgentConfig } from "../agent/types";
import type {
	FinishReason,
	Message,
	MessageUsage,
	PartStatus,
	Session,
} from "./types";

// P1 无工具 → 单步即完整回复；工具阶段（P2）再调高。
const MAX_STEPS = 1;

export interface SessionRuntimeDeps {
	sessionStore: SessionStore;
	messageStore: MessageStore;
	agentStore: AgentStore;
	modelFactory: ModelFactory;
}

export interface RunTurnInput {
	sessionId: string;
	text: string;
	abortSignal?: AbortSignal;
}

export interface SessionRuntime {
	runTurn(input: RunTurnInput): AsyncGenerator<RunEvent, Message>;
}

type StreamStatus = "complete" | "error" | "aborted";

interface StreamOutcome {
	usage: MessageUsage | null;
	finishReason: FinishReason;
	status: StreamStatus;
	errorMessage: string | null;
}

function errorToMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function buildSettings(params: AgentParams | null) {
	const settings: {
		temperature?: number;
		topP?: number;
		maxOutputTokens?: number;
	} = {};
	if (params?.temperature != null) {
		settings.temperature = params.temperature;
	}
	if (params?.topP != null) {
		settings.topP = params.topP;
	}
	if (params?.maxOutputTokens != null) {
		settings.maxOutputTokens = params.maxOutputTokens;
	}
	return settings;
}

/** 累积一类 part 的文本，结束时一次性落库（spec §8「finish 时落库」）。 */
function createPartBuffer(
	messageStore: MessageStore,
	messageId: string,
	type: "text" | "reasoning"
) {
	let buf = "";
	return {
		append(delta: string) {
			buf += delta;
		},
		async flush(status: PartStatus): Promise<void> {
			if (buf.length > 0) {
				await messageStore.appendPart({
					messageId,
					type,
					content: { text: buf },
					status,
				});
			}
		},
	};
}

async function loadContext(
	deps: SessionRuntimeDeps,
	sessionId: string
): Promise<{ session: Session; agent: AgentConfig }> {
	const session = await deps.sessionStore.get(sessionId);
	if (!session) {
		throw new Error(`Session ${sessionId} not found`);
	}
	const agent = await deps.agentStore.get(session.agentId);
	if (!agent) {
		throw new Error(`Agent ${session.agentId} not found`);
	}
	return { session, agent };
}

async function persistUserTurn(
	messageStore: MessageStore,
	sessionId: string,
	text: string
): Promise<void> {
	const userMessage = await messageStore.createMessage({
		sessionId,
		role: "user",
		status: "complete",
		providerId: null,
		modelId: null,
	});
	await messageStore.appendPart({
		messageId: userMessage.id,
		type: "text",
		content: { text },
		status: "complete",
	});
}

async function* streamAssistant(
	deps: SessionRuntimeDeps,
	model: Awaited<ReturnType<ModelFactory["create"]>>,
	messages: ModelMessage[],
	params: AgentParams | null,
	assistantId: string,
	abortSignal?: AbortSignal
): AsyncGenerator<RunEvent, StreamOutcome> {
	const textBuf = createPartBuffer(deps.messageStore, assistantId, "text");
	const reasoningBuf = createPartBuffer(deps.messageStore, assistantId, "reasoning");
	let usage: MessageUsage | null = null;
	let finishReason: FinishReason = "stop";
	let status: StreamStatus = "complete";
	let errorMessage: string | null = null;
	try {
		const result = streamText({
			model,
			messages,
			stopWhen: stepCountIs(MAX_STEPS),
			tools: {},
			abortSignal,
			...buildSettings(params),
		});
		for await (const chunk of result.fullStream) {
			if (chunk.type === "text-delta") {
				textBuf.append(chunk.text);
				yield { type: "text-delta", delta: chunk.text };
			} else if (chunk.type === "reasoning-delta") {
				reasoningBuf.append(chunk.text);
				yield { type: "reasoning-delta", delta: chunk.text };
			} else if (chunk.type === "finish-step") {
				yield { type: "step-finish" };
			} else if (chunk.type === "finish") {
				usage = mapUsage(chunk.totalUsage);
				finishReason = mapFinishReason(chunk.finishReason);
			} else if (chunk.type === "error") {
				status = "error";
				finishReason = "error";
				errorMessage = errorToMessage(chunk.error);
			} else if (chunk.type === "abort") {
				status = "aborted";
			}
		}
	} catch (error) {
		if (abortSignal?.aborted) {
			status = "aborted";
		} else {
			status = "error";
			finishReason = "error";
			errorMessage = errorToMessage(error);
		}
	} finally {
		const partStatus: PartStatus = status === "error" ? "error" : "complete";
		await reasoningBuf.flush(partStatus);
		await textBuf.flush(partStatus);
	}
	return { usage, finishReason, status, errorMessage };
}

export function createSessionRuntime(deps: SessionRuntimeDeps): SessionRuntime {
	return {
		async *runTurn({ sessionId, text, abortSignal }) {
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

			const final = await deps.messageStore.updateMessage(assistant.id, {
				status: outcome.status,
				usage: outcome.usage,
				finishReason: outcome.finishReason,
				error: outcome.errorMessage ? { message: outcome.errorMessage } : null,
			});
			if (outcome.status === "error") {
				await deps.sessionStore.setStatus(sessionId, "error");
				yield { type: "error", message: outcome.errorMessage ?? "stream error" };
			} else {
				yield {
					type: "done",
					usage: outcome.usage,
					finishReason: outcome.finishReason,
				};
			}
			return final ?? assistant;
		},
	};
}
```

> 说明：① user 消息与其 text part 由 `persistUserTurn` helper 用 async/await 串联（符合仓库「用 async/await 而非 promise 链」），并保持 `runTurn` 短；② `streamAssistant` 是带返回值的生成器，`runTurn` 用 `yield*` 转发其事件并拿到 `StreamOutcome`；③ 落库节流（中途 `updatePart`）与工具/abort 单测见 Global Constraints 的范围说明；④ `model` 形参类型用 `Awaited<ReturnType<ModelFactory["create"]>>` 避免直接 import `LanguageModelV3`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm -F @better-agent/agent test src/session/runtime.test.ts`
Expected: PASS（4 用例）。若某函数因 50 行限制被 pre-commit 拦截，抽顶层 helper（逻辑不变）后重跑。

- [ ] **Step 5: 全包测试 + 类型校验 + 提交**

Run: `pnpm -F @better-agent/agent test`
Expected: 全部 PASS。
Run: `pnpm -F @better-agent/agent check-types`
Expected: 通过。
```bash
pnpm fix
git add packages/agent/src/session/runtime.ts packages/agent/src/session/runtime.test.ts
git commit -m "feat(agent): add session runtime runTurn with streaming persistence"
```

---

## Task 4: `sessions` oRPC 路由 + 服务注入

**Files:**
- Create: `packages/api/src/routers/sessions.ts`
- Test: `packages/api/src/routers/sessions.test.ts`
- Modify: `packages/api/src/services.ts`, `packages/api/src/routers/index.ts`

**Interfaces:**
- Consumes: `SessionRuntime`（Task 3）、`SessionStore`/`MessageStore`（3a ports）、`AgentStore`（校验 agent 存在）、fakes（Task 2）+ `MockLanguageModelV3`（测试）。
- Produces: `sessionsRouter`（`create`/`get`/`list`/`listMessages`/`run`/`prompt`）挂到 `appRouter.sessions`；`AgentServices` 增 `runtime` 与 `stores.session`/`stores.message`。

- [ ] **Step 1: 改 `packages/api/src/services.ts`（增 `runtime` 与两个 store）**

把文件改为：
```ts
import type { AgentValidator } from "@better-agent/agent/agent/agent-validator";
import type {
	AgentStore,
	MessageStore,
	ModelCacheStore,
	ProviderCatalogStore,
	ProviderCredentialStore,
	SessionStore,
} from "@better-agent/agent/ports";
import type { ModelCatalog } from "@better-agent/agent/provider/model-catalog";
import type { ModelFactory } from "@better-agent/agent/provider/model-factory";
import type { SessionRuntime } from "@better-agent/agent/session/runtime";

export interface AgentServices {
	agentValidator: AgentValidator;
	catalog: ModelCatalog;
	modelFactory: ModelFactory;
	runtime: SessionRuntime;
	stores: {
		providerCatalog: ProviderCatalogStore;
		modelCache: ModelCacheStore;
		providerCredential: ProviderCredentialStore;
		agent: AgentStore;
		session: SessionStore;
		message: MessageStore;
	};
}
```

- [ ] **Step 2: 写 `packages/api/src/routers/sessions.ts`**

```ts
import type { RunEvent } from "@better-agent/agent/session/events";
import type { Message } from "@better-agent/agent/session/types";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { publicProcedure } from "../index";

const createInput = z.object({ agentId: z.uuid() });
const idInput = z.object({ id: z.uuid() });
const sessionIdInput = z.object({ sessionId: z.uuid() });
const promptInput = z.object({
	sessionId: z.uuid(),
	text: z.string().min(1),
});

async function requireSession(
	context: Context,
	sessionId: string
): Promise<void> {
	const session = await context.services.stores.session.get(sessionId);
	if (!session) {
		throw new ORPCError("NOT_FOUND", {
			message: `Session ${sessionId} not found`,
		});
	}
}

async function drain(
	gen: AsyncGenerator<RunEvent, Message>
): Promise<Message> {
	let next = await gen.next();
	while (!next.done) {
		next = await gen.next();
	}
	return next.value;
}

export const sessionsRouter = {
	create: publicProcedure
		.input(createInput)
		.handler(async ({ input, context }) => {
			const agent = await context.services.stores.agent.get(input.agentId);
			if (!agent) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Agent ${input.agentId} not found`,
				});
			}
			return context.services.stores.session.create({ agentId: input.agentId });
		}),

	get: publicProcedure
		.input(idInput)
		.handler(({ input, context }) =>
			context.services.stores.session.get(input.id)
		),

	list: publicProcedure.handler(({ context }) =>
		context.services.stores.session.list()
	),

	listMessages: publicProcedure
		.input(sessionIdInput)
		.handler(({ input, context }) =>
			context.services.stores.message.listWithParts(input.sessionId)
		),

	run: publicProcedure
		.input(promptInput)
		.handler(async ({ input, context, signal }) => {
			await requireSession(context, input.sessionId);
			return drain(
				context.services.runtime.runTurn({
					sessionId: input.sessionId,
					text: input.text,
					abortSignal: signal,
				})
			);
		}),

	prompt: publicProcedure
		.input(promptInput)
		.handler(async function* ({ input, context, signal }) {
			await requireSession(context, input.sessionId);
			yield* context.services.runtime.runTurn({
				sessionId: input.sessionId,
				text: input.text,
				abortSignal: signal,
			});
		}),
};
```

- [ ] **Step 3: 挂载到 `packages/api/src/routers/index.ts`**

把文件改为（新增 `sessions` import 与挂载，其余不动）：
```ts
import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { agentsRouter } from "./agents";
import { providersRouter } from "./providers";
import { sessionsRouter } from "./sessions";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => "OK"),
	providers: providersRouter,
	agents: agentsRouter,
	sessions: sessionsRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
```

- [ ] **Step 4: 写 `packages/api/src/routers/sessions.test.ts`**

```ts
import type { LanguageModelV3, LanguageModelV3StreamPart } from "@ai-sdk/provider";
import {
	createFakeAgentStore,
	createFakeMessageStore,
	createFakeSessionStore,
} from "@better-agent/agent/testing/fakes";
import { createSessionRuntime } from "@better-agent/agent/session/runtime";
import { createRouterClient } from "@orpc/server";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const HAPPY: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "Hi there" },
	{ type: "text-end", id: "0" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: {
			inputTokens: { total: 3, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
			outputTokens: { total: 2, text: undefined, reasoning: undefined },
		},
	},
];

function mockModel(chunks: LanguageModelV3StreamPart[]): LanguageModelV3 {
	return new MockLanguageModelV3({
		doStream: () => Promise.resolve({ stream: simulateReadableStream({ chunks }) }),
	});
}

async function buildClient() {
	const agentStore = createFakeAgentStore();
	const sessionStore = createFakeSessionStore();
	const messageStore = createFakeMessageStore();
	const agent = await agentStore.create({
		name: "Helper",
		description: "d",
		systemPrompt: "You are helpful.",
		providerId: "openai",
		modelId: "gpt-x",
		params: null,
	});
	const runtime = createSessionRuntime({
		sessionStore,
		messageStore,
		agentStore,
		modelFactory: { create: () => Promise.resolve(mockModel(HAPPY)) },
	});
	const services = {
		// only the fields the sessions router touches are needed for these tests
		runtime,
		stores: { agent: agentStore, session: sessionStore, message: messageStore },
	};
	const client = createRouterClient(appRouter, {
		context: { services: services as never },
	});
	return { client, agentId: agent.id };
}

it("create rejects an unknown agent and accepts a known one", async () => {
	const { client, agentId } = await buildClient();
	await expect(
		client.sessions.create({ agentId: "00000000-0000-0000-0000-000000000000" })
	).rejects.toThrow();
	const session = await client.sessions.create({ agentId });
	expect(session.id).toBeTruthy();
	expect(session.agentId).toBe(agentId);
});

it("run returns the final assistant message and listMessages replays history", async () => {
	const { client, agentId } = await buildClient();
	const session = await client.sessions.create({ agentId });
	const final = await client.sessions.run({ sessionId: session.id, text: "hello" });
	expect(final.role).toBe("assistant");
	expect(final.status).toBe("complete");

	const history = await client.sessions.listMessages({ sessionId: session.id });
	expect(history.map((h) => h.message.role)).toEqual(["user", "assistant"]);
	expect(history[1]?.parts[0]?.content).toEqual({ text: "Hi there" });
});

it("prompt streams run events ending with done", async () => {
	const { client, agentId } = await buildClient();
	const session = await client.sessions.create({ agentId });
	const events = [];
	for await (const event of await client.sessions.prompt({
		sessionId: session.id,
		text: "hello",
	})) {
		events.push(event);
	}
	expect(events.some((e) => e.type === "message-start")).toBe(true);
	expect(events.at(-1)?.type).toBe("done");
});

it("run rejects an unknown session", async () => {
	const { client } = await buildClient();
	await expect(
		client.sessions.run({
			sessionId: "00000000-0000-0000-0000-000000000000",
			text: "hi",
		})
	).rejects.toThrow();
});
```

> 说明：测试只注入 sessions 路由实际用到的 services 字段，用 `as never` 绕过 `AgentServices` 全量类型（沿用 providers.test.ts 用最小 services 的做法）；`client.sessions.prompt(...)` 返回 event iterator，`for await` 消费。

- [ ] **Step 5: 运行测试 + 类型校验 + 提交**

Run: `pnpm -F @better-agent/api test`
Expected: 全部 PASS（既有 providers 2 例 + 新 sessions 4 例）。
Run: `pnpm -F @better-agent/api exec tsc --noEmit`
Expected: 通过。
```bash
pnpm fix
git add packages/api/src/services.ts packages/api/src/routers/sessions.ts packages/api/src/routers/index.ts packages/api/src/routers/sessions.test.ts
git commit -m "feat(api): add sessions router with streaming prompt and run"
```

---

## Task 5: 组装到 `apps/server` + 端到端验证

**Files:**
- Modify: `apps/server/src/index.ts`

**Interfaces:**
- Consumes: `createSessionStore`/`createMessageStore`（3a, `@better-agent/db`）、`createSessionRuntime`（Task 3）。
- Produces: 注入了 `runtime` + `stores.session`/`stores.message` 的 `services`。

- [ ] **Step 1: 改 `apps/server/src/index.ts`**

在 import 区增加：
```ts
import { createSessionRuntime } from "@better-agent/agent/session/runtime";
import {
	createMessageStore,
	createSessionStore,
} from "@better-agent/db/repositories/message-store";
```
> 注意：`createMessageStore` 在 `repositories/message-store`，`createSessionStore` 在 `repositories/session-store`——分两条 import：
```ts
import { createMessageStore } from "@better-agent/db/repositories/message-store";
import { createSessionStore } from "@better-agent/db/repositories/session-store";
```

把 `buildServices()` 内 `modelFactory` 提为具名 const、并组装 session/message/runtime。即把现有 `return { ... }` 之前改为：
```ts
	const session = createSessionStore(db);
	const message = createMessageStore(db);
	const modelFactory = createModelFactory({
		catalogStore: providerCatalog,
		credentialStore: providerCredential,
	});
	const runtime = createSessionRuntime({
		sessionStore: session,
		messageStore: message,
		agentStore: agent,
		modelFactory,
	});
	return {
		catalog: createModelCatalog({
			catalogStore: providerCatalog,
			modelStore: modelCache,
			fetcher: () => fetchModelsDev(env.MODELS_DEV_URL),
		}),
		modelFactory,
		agentValidator,
		runtime,
		stores: {
			providerCatalog,
			modelCache,
			providerCredential,
			agent,
			session,
			message,
		},
	};
```
> 即：原先 `return` 里内联的 `createModelFactory(...)` 改为引用上面提出来的 `modelFactory` const（runtime 与 services 共用同一个实例）。

- [ ] **Step 2: 全仓库校验类型**

Run: `pnpm check-types`
Expected: 全部通过。
Run: `pnpm -F @better-agent/api exec tsc --noEmit`
Expected: 通过。

- [ ] **Step 3: 端到端手动验证（需 postgres 在跑、所有 migration 已应用）**

```bash
pnpm db:start
pnpm -F @better-agent/db db:push
pnpm -F server dev
```
另开终端：先建 provider 凭证（真实或占位）+ 刷新 catalog + 建 agent，再建 session 并对话。
```bash
curl -s -X POST localhost:3000/rpc/providers/catalogRefresh -d '{}'
curl -s -X POST localhost:3000/rpc/providers/credentialsUpsert -H 'content-type: application/json' \
  -d '{"json":{"providerId":"anthropic","apiKey":"sk-ant-REAL","baseURL":null,"enabled":true}}'
# 建 agent（拿到 agentId）
curl -s -X POST localhost:3000/rpc/agents/create -H 'content-type: application/json' \
  -d '{"json":{"name":"Helper","description":"helps","systemPrompt":"You are helpful.","providerId":"anthropic","modelId":"claude-opus-4-5","params":null}}'
# 建 session（用上一步 agentId）
curl -s -X POST localhost:3000/rpc/sessions/create -H 'content-type: application/json' \
  -d '{"json":{"agentId":"<AGENT_ID>"}}'
# 非流式一轮（需真实 key 才会真出文本）
curl -s -X POST localhost:3000/rpc/sessions/run -H 'content-type: application/json' \
  -d '{"json":{"sessionId":"<SESSION_ID>","text":"Say hi in 3 words."}}'
# 历史回放
curl -s -X POST localhost:3000/rpc/sessions/listMessages -H 'content-type: application/json' \
  -d '{"json":{"sessionId":"<SESSION_ID>"}}'
```
Expected:
- `sessions/create` 返回带 `id`、`agentId`、`status:"active"` 的 session；未知 agentId → `BAD_REQUEST`。
- 有真实 key 时 `sessions/run` 返回 `status:"complete"` 的 assistant 消息；`listMessages` 返回 `[user, assistant]` 且 assistant 含 text part。
- 流式 `prompt` 用 web 端 oRPC client `for await (const ev of orpc.sessions.prompt({...}))` 验证更稳妥（curl 看 SSE 也可）。
- abort：流式途中断开客户端，assistant 消息应落为 `aborted`（验证 Global Constraints 里 abort 路径）。

> 无真实 key 时，可只验证「create / 未知 agent BAD_REQUEST / 未知 session NOT_FOUND」这些不触发模型的路径；真实出文本需有效凭证。

- [ ] **Step 4: 提交**

```bash
pnpm fix
git add apps/server
git commit -m "feat(server): assemble session runtime and stores into context"
```

---

## Self-Review（计划作者自检结论）

- **Spec 覆盖**：覆盖 spec 第 7 节（`runTurn`：落 user 消息+part、建 streaming assistant、`toModelMessages` 拼上下文、`createLanguageModel`、`streamText` + `stopWhen: stepCountIs`、消费 `fullStream`、收尾置 complete + usage/finishReason，Task 3）+ 第 8 节流事件/增量落库表的 🔨 行（message-start/text-delta/reasoning-delta/step-finish/finish=done/异常=error，Task 3；tool-* 行 📐 不做）+ 第 11 节 `sessions`（`create`/`get`/`list`/`listMessages`/`prompt`→event iterator/`run`→最终消息，Task 4）。tool-* 事件与 parts、压缩触发、Permission 接线、节流 `updatePart`、Client SDK/admin 均按范围显式划出，非遗漏。
- **占位扫描**：无 TBD；每步含完整代码或精确命令+期望输出。流式相关 chunk 名/字段（`text-delta.text`/`finish.totalUsage`/`finish.finishReason`/reject→error chunk）均来自对 `ai@6.0.205` 的实测、已写进 Global Constraints。
- **类型一致性**：`RunEvent`（Task 1）在 Task 3 runtime `yield`、Task 4 路由透传一致；`mapUsage`/`mapFinishReason`（Task 1）在 runtime `finish`/`error` 分支消费；`SessionRuntime.runTurn` 返回 `AsyncGenerator<RunEvent, Message>`（Task 3）被 Task 4 `drain`（取 `next.value: Message`）与 `prompt`（`yield*`）一致消费；`AgentServices`（Task 4 services.ts 增 `runtime`/`stores.session`/`stores.message`）在 Task 4 路由与 Task 5 server 组装一致填充；fakes（Task 2）实现的 port 签名与 3a ports 一致，被 Task 3/4 测试注入。
- **已知风险**：① runtime 多个函数逼近 50 行（`streamAssistant`/`runTurn`）——已预拆 `loadContext`/`createPartBuffer`/`buildSettings`/`streamAssistant` helper；若仍超限按 3a 经验再拆，逻辑不变。② 错误路径依赖「reject doStream → fullStream `error` chunk 且不抛」这一实测行为；`try/catch` 作为防御（abort/真抛错也归位）。③ abort 无确定性单测（计时不确定），靠 Task 5 手动 e2e；代码已处理 `abort` chunk 与 `AbortError`。④ `sessions.test.ts` 用 `as never` 注入最小 services（仅 runtime + 三个 store），与 providers.test.ts 同法；若 oRPC 对 context 类型更严导致不过，改为补齐 `AgentServices` 其余字段为最小桩。⑤ `prompt` 是 async-generator handler；若 RPCHandler 对生成器 handler 的类型推断异常，回退用 `eventIterator(zodSchema)` 显式标注 `.output(...)`（`@orpc/server` 已导出 `eventIterator`）。⑥ server 端 `modelFactory` 由内联改为具名 const 并与 runtime 共享——注意不要遗留两处 `createModelFactory` 调用（只保留具名那一处）。
