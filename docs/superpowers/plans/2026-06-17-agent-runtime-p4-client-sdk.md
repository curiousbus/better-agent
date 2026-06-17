# Plan 4：对外 Client TS SDK（`packages/client`）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付对外 TS SDK `@better-agent/client`：`createAgentClient({ baseURL, agentId })` 返回一个绑定单一 agent 的 client，提供 `createSession` / `run` / `stream` / `listMessages`，内部封装 oRPC client（指向 `baseURL/rpc`），**只依赖 oRPC 契约类型 `AppRouter`**、不依赖 server 内部代码。

**Architecture:** 一个薄包装层。`createAgentClientFrom(client, agentId)` 接受一个已建好的 `RouterClient<AppRouter>`（便于注入测试），绑定 agentId、按需自动建会话、把 `sessions.prompt` 的 event iterator 转发出来；`createAgentClient({ baseURL, agentId })` 用 `createORPCClient(new RPCLink({ url }))` 建 HTTP client 再委托给前者。对外类型（`Message`/`RunEvent`/`MessageHistory`）全部从 `RouterClient<AppRouter>` **推断**，因此 `packages/client` 不 import `packages/agent`。详见 `docs/superpowers/specs/2026-06-16-agent-runtime-design.md` 第 13 节。

**Tech Stack:** TypeScript(ESM, strict, `verbatimModuleSyntax`) · Vitest · oRPC(1.14.x，`@orpc/client` + `@orpc/server` 的 `RouterClient` 类型推断 + event iterator)。

## Global Constraints

- 每个 commit 前先跑 `pnpm fix`（biome）再提交；禁 `^`/`~`/`latest`；装包用 `pnpm add -E`；`@orpc/client`/`@orpc/server` 用 `catalog:`。
- 文件名 kebab-case；函数 ≤50 行、圈复杂度 ≤10；禁 `any`（测试里对 stub client 的 `as unknown as RouterClient<AppRouter>` 是允许的注入模式，等同既有 `providers.test.ts`/`sessions.test.ts` 的 `as never`）；禁 `console`。
- `tsconfig.base` 开启 `verbatimModuleSyntax: true` → 仅类型的导入必须用 `import type`（`RouterClient`/`AppRouter` 用 `import type`；`createORPCClient`/`RPCLink` 是运行时值，普通 import）。还开了 `noUnusedLocals`/`noUnusedParameters`/`noUncheckedIndexedAccess`。
- **决策（本计划已定）**：① 会话**无状态**——caller 持有 sessionId；`run`/`stream` 的 `sessionId` 可选，省略则**自动新建一次性会话**用于本轮。② **abort 不引入新事件**——`stream` 原样转发 `RunEvent`（abort 仍以 `done` 收尾）；SDK 文档注明：要区分 abort，调用方走带外路径用 `listMessages` 看最后一条 assistant 消息的 `status`（`aborted`）。
- **范围**：本期交付 `createSession`/`run`/`stream`/`listMessages`。**不做**：远程工具 `tools` 参数（spec §10，📐 P2）、鉴权 `apiKey`（延后）、重试/超时/取消封装（caller 自理）。`createAgentClient`（HTTP 版）只做类型校验 + 可选手动 e2e；可单测的逻辑全在 `createAgentClientFrom`。
- **已验证**：`Awaited<ReturnType<RouterClient<AppRouter>["sessions"]["create"]>>` 含 `.id`；`...["run"]` = `Message`（含 `id`/`role`/`status`）；`...["listMessages"]` = `MessageWithParts[]`（元素含 `message`）；`...["prompt"]` = `AsyncIterable<RunEvent>`（元素含 `type`）。这些推断已用 `tsc` 实测通过。

---

## 文件结构

**Create:**
- `packages/client/package.json` — 包清单（`@better-agent/client`）
- `packages/client/tsconfig.json` — 继承 config base 的 leaf 配置
- `packages/client/src/index.ts` — SDK：类型 + `createAgentClientFrom` + `createAgentClient`
- `packages/client/src/index.test.ts` — 用 stub `RouterClient` 的单测

> 说明：`packages/*` 已被 `pnpm-workspace.yaml` 通配，无需改 workspace 文件。`packages/client` 与 server/web/admin 同级，是外部消费方接入点。

---

## Task 1: 脚手架 `packages/client` + 类型契约

**Files:**
- Create: `packages/client/package.json`, `packages/client/tsconfig.json`, `packages/client/src/index.ts`（**仅类型**，本任务先不写实现函数）

**Interfaces:**
- Produces: `index.ts` 导出类型 `Message`、`MessageHistory`、`RunEvent`、`AgentClientConfig`、`RunOptions`、`AgentClient`（接口）。Task 2 实现 `createAgentClientFrom`/`createAgentClient` 来满足 `AgentClient`。

- [ ] **Step 1: 写 `packages/client/package.json`**

```json
{
  "name": "@better-agent/client",
  "type": "module",
  "private": true,
  "exports": {
    ".": {
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "check-types": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@better-agent/api": "workspace:*",
    "@orpc/client": "catalog:",
    "@orpc/server": "catalog:"
  },
  "devDependencies": {
    "@better-agent/config": "workspace:*",
    "@types/node": "catalog:",
    "typescript": "catalog:",
    "vitest": "4.1.9"
  }
}
```

- [ ] **Step 2: 写 `packages/client/tsconfig.json`**

```json
{
  "extends": "@better-agent/config/tsconfig.base.json",
  "compilerOptions": {
    "strictNullChecks": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 写 `packages/client/src/index.ts`（仅类型契约，无实现）**

```ts
import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";

type Client = RouterClient<AppRouter>;

/** 最终 assistant 消息（从 sessions.run 推断，避免依赖 packages/agent）。 */
export type Message = Awaited<ReturnType<Client["sessions"]["run"]>>;

/** 会话历史（从 sessions.listMessages 推断）。 */
export type MessageHistory = Awaited<
	ReturnType<Client["sessions"]["listMessages"]>
>;

type PromptStream = Awaited<ReturnType<Client["sessions"]["prompt"]>>;

/** 流式运行事件（从 sessions.prompt 的 event iterator 推断）。 */
export type RunEvent = PromptStream extends AsyncIterable<infer E> ? E : never;

export interface AgentClientConfig {
	/** server 根地址，如 "http://localhost:3000"；SDK 自动拼 "/rpc"。 */
	baseURL: string;
	/** 本 client 绑定的 agent（创建 session 时用）。 */
	agentId: string;
}

export interface RunOptions {
	/** 继续指定会话；省略则自动新建一次性会话。 */
	sessionId?: string;
}

export interface AgentClient {
	/** 新建一个绑定本 client agent 的会话。 */
	createSession(): Promise<{ sessionId: string }>;
	/** 跑一轮，返回最终 assistant 消息（无 sessionId 则自动建会话）。 */
	run(text: string, options?: RunOptions): Promise<Message>;
	/** 跑一轮并流式返回运行事件（无 sessionId 则自动建会话）。 */
	stream(text: string, options?: RunOptions): AsyncGenerator<RunEvent>;
	/** 回放会话全部消息及其 parts。 */
	listMessages(sessionId: string): Promise<MessageHistory>;
}
```

> 说明：本步只导入类型（`import type`），不引入 `createORPCClient`/`RPCLink`，避免 `noUnusedLocals` 报未用导入；运行时导入在 Task 2 随实现一起加。`Client` 仅被其他类型别名引用，不会触发未用告警。

- [ ] **Step 4: 安装 + 类型校验 + 提交**

Run: `pnpm install`
Expected: 识别新包 `@better-agent/client`，`pnpm-lock.yaml` 更新（一并提交）。
Run: `pnpm -F @better-agent/client check-types`
Expected: 通过（`TypeScript: No errors found`）。
```bash
pnpm fix
git add packages/client pnpm-lock.yaml
git commit -m "feat(client): scaffold agent SDK package with typed contract"
```

---

## Task 2: 实现 `createAgentClientFrom` / `createAgentClient` + 单测

**Files:**
- Create: `packages/client/src/index.test.ts`
- Modify: `packages/client/src/index.ts`（追加运行时导入与两个函数）

**Interfaces:**
- Consumes: Task 1 的类型（`AgentClient`/`AgentClientConfig`/`RunOptions`/`Message`/`MessageHistory`/`RunEvent`）；`RouterClient<AppRouter>`、`createORPCClient`、`RPCLink`。
- Produces: `createAgentClientFrom(client: RouterClient<AppRouter>, agentId: string): AgentClient`、`createAgentClient(config: AgentClientConfig): AgentClient`。

- [ ] **Step 1: 写失败测试 `packages/client/src/index.test.ts`**

```ts
import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { createAgentClientFrom, type RunEvent } from "./index";

const AGENT_ID = "agent-123";
const SESSION_ID = "session-abc";

interface Calls {
	create: Array<{ agentId: string }>;
	run: Array<{ sessionId: string; text: string }>;
	prompt: Array<{ sessionId: string; text: string }>;
	listMessages: Array<{ sessionId: string }>;
}

function stubClient(events: RunEvent[] = []) {
	const calls: Calls = { create: [], run: [], prompt: [], listMessages: [] };
	const client = {
		sessions: {
			create(input: { agentId: string }) {
				calls.create.push(input);
				return Promise.resolve({ id: SESSION_ID });
			},
			run(input: { sessionId: string; text: string }) {
				calls.run.push(input);
				return Promise.resolve({
					id: "m1",
					role: "assistant",
					status: "complete",
				});
			},
			prompt(input: { sessionId: string; text: string }) {
				calls.prompt.push(input);
				async function* gen() {
					for (const event of events) {
						yield event;
					}
				}
				return Promise.resolve(gen());
			},
			listMessages(input: { sessionId: string }) {
				calls.listMessages.push(input);
				return Promise.resolve([{ message: { id: "m1" }, parts: [] }]);
			},
		},
	} as unknown as RouterClient<AppRouter>;
	return { client, calls };
}

describe("createAgentClientFrom", () => {
	it("createSession binds the configured agentId and returns the new sessionId", async () => {
		const { client, calls } = stubClient();
		const sdk = createAgentClientFrom(client, AGENT_ID);
		expect(await sdk.createSession()).toEqual({ sessionId: SESSION_ID });
		expect(calls.create).toEqual([{ agentId: AGENT_ID }]);
	});

	it("run auto-creates a session when none is given, then runs with it", async () => {
		const { client, calls } = stubClient();
		const sdk = createAgentClientFrom(client, AGENT_ID);
		const message = await sdk.run("hi");
		expect(calls.create).toEqual([{ agentId: AGENT_ID }]);
		expect(calls.run).toEqual([{ sessionId: SESSION_ID, text: "hi" }]);
		expect(message).toMatchObject({ role: "assistant", status: "complete" });
	});

	it("run reuses an explicit sessionId without creating one", async () => {
		const { client, calls } = stubClient();
		const sdk = createAgentClientFrom(client, AGENT_ID);
		await sdk.run("hi", { sessionId: "explicit" });
		expect(calls.create).toEqual([]);
		expect(calls.run).toEqual([{ sessionId: "explicit", text: "hi" }]);
	});

	it("stream forwards run events from prompt for an explicit session", async () => {
		const events = [
			{ type: "message-start", messageId: "m1" },
			{ type: "text-delta", delta: "hi" },
			{ type: "done", usage: null, finishReason: "stop" },
		] as RunEvent[];
		const { client, calls } = stubClient(events);
		const sdk = createAgentClientFrom(client, AGENT_ID);
		const received: RunEvent[] = [];
		for await (const event of sdk.stream("hi", { sessionId: "s1" })) {
			received.push(event);
		}
		expect(received).toEqual(events);
		expect(calls.prompt).toEqual([{ sessionId: "s1", text: "hi" }]);
	});

	it("stream auto-creates a session when none is given", async () => {
		const { client, calls } = stubClient([]);
		const sdk = createAgentClientFrom(client, AGENT_ID);
		const received: RunEvent[] = [];
		for await (const event of sdk.stream("hi")) {
			received.push(event);
		}
		expect(received).toEqual([]);
		expect(calls.create).toEqual([{ agentId: AGENT_ID }]);
		expect(calls.prompt).toEqual([{ sessionId: SESSION_ID, text: "hi" }]);
	});

	it("listMessages passes the sessionId through", async () => {
		const { client, calls } = stubClient();
		const sdk = createAgentClientFrom(client, AGENT_ID);
		const history = await sdk.listMessages("s9");
		expect(calls.listMessages).toEqual([{ sessionId: "s9" }]);
		expect(history.length).toBe(1);
	});
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm -F @better-agent/client test src/index.test.ts`
Expected: FAIL（`createAgentClientFrom` 未定义 / 未导出）。

- [ ] **Step 3: 在 `packages/client/src/index.ts` 追加运行时导入与两个函数**

在文件**顶部 import 区**增加（与已有 `import type` 并列；运行时值用普通 import）：
```ts
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
```

在文件**末尾**追加实现：
```ts
/** 用已有 oRPC client 构造 SDK（便于注入测试）。 */
export function createAgentClientFrom(
	client: Client,
	agentId: string
): AgentClient {
	const ensureSession = async (sessionId?: string): Promise<string> =>
		sessionId ?? (await client.sessions.create({ agentId })).id;
	return {
		async createSession() {
			const session = await client.sessions.create({ agentId });
			return { sessionId: session.id };
		},
		async run(text, options) {
			const sessionId = await ensureSession(options?.sessionId);
			return client.sessions.run({ sessionId, text });
		},
		async *stream(text, options) {
			const sessionId = await ensureSession(options?.sessionId);
			const events = await client.sessions.prompt({ sessionId, text });
			for await (const event of events) {
				yield event;
			}
		},
		listMessages(sessionId) {
			return client.sessions.listMessages({ sessionId });
		},
	};
}

/** 创建一个绑定 baseURL + agentId 的 Agent SDK client。 */
export function createAgentClient(config: AgentClientConfig): AgentClient {
	const link = new RPCLink({ url: `${config.baseURL}/rpc` });
	const client = createORPCClient(link) as Client;
	return createAgentClientFrom(client, config.agentId);
}
```

> 说明：① `ensureSession` 把「无 sessionId 自动建会话」收敛到一处，`run`/`stream` 共用；② `stream` 是 `async *` 生成器，`await client.sessions.prompt(...)` 拿到 event iterator 后 `for await ... yield` 原样转发（abort 仍以 `done` 收尾，见 Global Constraints 决策②）；③ `createORPCClient(link) as Client` 沿用 web 端 `apps/web/src/utils/orpc.ts` 的写法。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm -F @better-agent/client test src/index.test.ts`
Expected: PASS（6 个用例）。

- [ ] **Step 5: 类型校验 + 提交**

Run: `pnpm -F @better-agent/client check-types`
Expected: 通过。
Run: `pnpm check-types`
Expected: 全仓库通过（新包的 `check-types` 被 turbo 纳入）。
```bash
pnpm fix
git add packages/client/src/index.ts packages/client/src/index.test.ts
git commit -m "feat(client): implement agent SDK run/stream/createSession/listMessages"
```

- [ ] **Step 6: 可选手动 e2e（需 server 在跑、有真实凭证；不阻塞）**

在一个临时脚本或 node REPL 里（仓库内任意能 resolve workspace 包的位置）：
```ts
import { createAgentClient } from "@better-agent/client";
const client = createAgentClient({ baseURL: "http://localhost:3000", agentId: "<AGENT_ID>" });
const { sessionId } = await client.createSession();
for await (const ev of client.stream("Say hi in 3 words.", { sessionId })) {
	// 期望先后看到 message-start → text-delta... → done
	process.stdout.write(JSON.stringify(ev) + "\n");
}
console.log(await client.listMessages(sessionId)); // [user, assistant]
```
Expected：`stream` 实时逐个产出事件（message-start → text-delta… → done）；`listMessages` 返回 `[user, assistant]`。无真实 key 时可只验证 `createSession` 与（未知 agentId 时）`run` 报错路径。

---

## Self-Review（计划作者自检结论）

- **Spec 覆盖**：覆盖 spec 第 13 节全部 4 个方法 —— `createSession()`（Task 2，返回 `{ sessionId }`）、`run(text,{sessionId?})`（Task 2，最终消息、无 sessionId 自动建）、`stream(text,{sessionId?})`（Task 2，事件流、无 sessionId 自动建）、`listMessages(sessionId)`（Task 2）；「内部：oRPC client 指向 baseURL、固定 agentId；只依赖 oRPC 契约类型」由 `createAgentClient` + 从 `RouterClient<AppRouter>` 推断类型实现（不 import `packages/agent`）。spec §13 的 `tools`（远程工具 📐）与 `apiKey`（鉴权）按 Global Constraints 显式划出本期，非遗漏。
- **占位扫描**：无 TBD；每步含完整代码或精确命令+期望输出。
- **类型一致性**：`AgentClient`/`AgentClientConfig`/`RunOptions`/`Message`/`MessageHistory`/`RunEvent`（Task 1）在 Task 2 实现与测试中一致使用；`createAgentClientFrom(client, agentId)` 与 `createAgentClient(config)` 签名在 Task 2 内自洽；测试 stub 的 `sessions.{create,run,prompt,listMessages}` 形状与 SDK 调用一致（`create({agentId})→{id}`、`run({sessionId,text})→Message`、`prompt({sessionId,text})→AsyncIterable<RunEvent>`、`listMessages({sessionId})→数组`）。
- **已知风险**：① `createORPCClient(link) as Client` 用断言（与 web 端一致，oRPC 官方推荐写法），非 `any`；② `prompt` 经 RouterClient 返回 `Promise<AsyncIterable<RunEvent>>`，故 SDK 用 `await client.sessions.prompt(...)` 再 `for await`（已在 3b `sessions.test.ts` 验证此调用形态）；③ 测试 stub 用 `as unknown as RouterClient<AppRouter>` 注入（与 `providers.test.ts`/`sessions.test.ts` 同法），只实现被调用到的 `sessions` 子集；④ `verbatimModuleSyntax` 下务必 `import type` 引类型、普通 import 引 `createORPCClient`/`RPCLink`，否则 tsc 报错；⑤ `createAgentClient`（HTTP 版）不可纯单测，靠 Task 1/2 的 `check-types` + Task 2 Step 6 可选手动 e2e 覆盖。
