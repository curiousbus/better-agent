# Plan 3a：Session 数据层（sessions/messages/message_parts + toModelMessages）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地有状态会话的**数据层**：`sessions`/`messages`/`message_parts` 三张表、`SessionStore`/`MessageStore` 两个 Drizzle 仓储，以及把会话历史转成 AI SDK `ModelMessage[]` 的纯函数 `toModelMessages`——为 Plan 3b 的运行时循环（`runTurn` + 流式）打好可独立测试的地基。

**Architecture:** 沿用既有「隔离运行时 + 依赖注入」分层。`packages/agent` 定义 `Session`/`Message`/`MessagePart` 领域类型、`SessionStore`/`MessageStore` port、纯函数 `toModelMessages`；`packages/db` 用 Drizzle 实现两个 store（seq 在事务内分配）；本计划**不碰 `packages/api`/`apps/server`**（流式 prompt/run 路由属 Plan 3b）。详见 `docs/superpowers/specs/2026-06-16-agent-runtime-design.md` 第 5–6 节。

**Tech Stack:** TypeScript(ESM, strict) · Vitest · PGlite(集成测试) · Drizzle(node-postgres / pglite) · AI SDK `ai`(已装 6.0.205，`ModelMessage` 类型)。

## Global Constraints

- 每个 commit 前先跑 `pnpm fix`（biome 自动修复）再提交。
- 仓库禁止 `^`/`~`/`latest` 版本；安装一律 `pnpm add -E`。本计划**不新增依赖**（`ai` 已在 `packages/agent`）。
- 文件名 kebab-case；函数 ≤50 行、圈复杂度 ≤10；禁 `any`/`console`；禁 barrel file（schema/index 已有 `noBarrelFile` 豁免，沿用）。
- `packages/agent` **不得 import `packages/db`**；只定义 port，db 反向实现。
- 魔法数字要抽常量；优先 `for...of`；`const` 默认。
- **范围**：本计划只交付 session 数据层 + 转换层。运行时 `runTurn`、流式事件、增量落库、`sessions` oRPC 路由（含 event-iterator `prompt`）、server 组装 = Plan 3b。压缩逻辑（写 `summary`/`compactedThroughSeq`）= P2；本计划只把**列、port 方法、`toModelMessages` 的摘要分支**结构就位（📐），不实现触发逻辑。工具 part（tool-call/tool-result）本期不产生数据：表/类型结构定死（📐），`toModelMessages` 暂只映射 text/reasoning。

---

## 文件结构

**Create:**
- `packages/agent/src/session/types.ts` — session/message/part 领域类型 + 输入/补丁类型
- `packages/agent/src/session/to-model-messages.ts` — 纯函数：会话历史 → `ModelMessage[]`
- `packages/agent/src/session/to-model-messages.test.ts`
- `packages/db/src/schema/sessions.ts` — `sessions`/`messages`/`message_parts` 三表
- `packages/db/src/repositories/session-store.ts` — `SessionStore` 的 Drizzle 实现
- `packages/db/src/repositories/session-store.integration.test.ts`
- `packages/db/src/repositories/message-store.ts` — `MessageStore` 的 Drizzle 实现
- `packages/db/src/repositories/message-store.integration.test.ts`

**Modify:**
- `packages/agent/src/ports.ts` — 增加 `SessionStore`/`MessageStore` 接口
- `packages/agent/package.json` — `exports` 增加 `"./session/*"`
- `packages/db/src/schema/index.ts` — 导出 `sessions` schema

---

## Task 1: session 领域类型 + 两个 store port + 包导出

**Files:**
- Create: `packages/agent/src/session/types.ts`
- Modify: `packages/agent/src/ports.ts`, `packages/agent/package.json`

**Interfaces:**
- Produces: `session/types.ts` 导出 `Session`/`SessionInput`/`SessionStatus`/`MessageRole`/`MessageStatus`/`FinishReason`/`MessageUsage`/`MessageError`/`Message`/`MessageInput`/`MessagePatch`/`MessagePartType`/`PartStatus`/`TextPartContent`/`ReasoningPartContent`/`ToolCallPartContent`/`ToolResultPartContent`/`MessagePartContent`/`MessagePart`/`MessagePartInput`/`MessagePartPatch`/`MessageWithParts`；`ports.ts` 导出 `SessionStore`/`MessageStore`。Task 2/3/4/5 全部消费这些类型。

- [ ] **Step 1: 写 `packages/agent/src/session/types.ts`（领域类型，无逻辑、无测试）**

```ts
/** Session 生命周期状态。error 表示上一轮运行失败。 */
export type SessionStatus = "active" | "error";

export interface Session {
	id: string;
	/** 创建时绑定的 agent，不可改。 */
	agentId: string;
	/** 首条 user 消息自动摘要；未生成前为 null。 */
	title: string | null;
	status: SessionStatus;
	/** 📐 压缩摘要（P2 compaction 写入）。 */
	summary: string | null;
	/** 📐 已压缩到的 message.seq（含）；P2 compaction 写入。 */
	compactedThroughSeq: number | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface SessionInput {
	agentId: string;
}

export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus =
	| "pending"
	| "streaming"
	| "complete"
	| "error"
	| "aborted";

export type FinishReason = "stop" | "length" | "tool-calls" | "error";

export interface MessageUsage {
	inputTokens: number | null;
	outputTokens: number | null;
	totalTokens: number | null;
}

export interface MessageError {
	message: string;
}

export interface Message {
	id: string;
	sessionId: string;
	role: MessageRole;
	/** 会话内单调递增，从 0 开始。 */
	seq: number;
	status: MessageStatus;
	/** assistant 实际所用模型；user/system 为 null。 */
	providerId: string | null;
	modelId: string | null;
	usage: MessageUsage | null;
	finishReason: FinishReason | null;
	error: MessageError | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface MessageInput {
	sessionId: string;
	role: MessageRole;
	status: MessageStatus;
	providerId: string | null;
	modelId: string | null;
}

/** 增量更新 assistant 消息：只带要改的字段。 */
export interface MessagePatch {
	status?: MessageStatus;
	providerId?: string | null;
	modelId?: string | null;
	usage?: MessageUsage | null;
	finishReason?: FinishReason | null;
	error?: MessageError | null;
}

export type MessagePartType =
	| "text"
	| "reasoning"
	| "tool-call"
	| "tool-result";

export type PartStatus = "streaming" | "complete" | "error";

export interface TextPartContent {
	text: string;
}

export interface ReasoningPartContent {
	text: string;
}

/** 📐 工具阶段写入，P1 不产生。 */
export interface ToolCallPartContent {
	callId: string;
	toolName: string;
	args: unknown;
}

/** 📐 工具阶段写入，P1 不产生。 */
export interface ToolResultPartContent {
	callId: string;
	result: unknown;
	isError: boolean;
}

export type MessagePartContent =
	| TextPartContent
	| ReasoningPartContent
	| ToolCallPartContent
	| ToolResultPartContent;

interface MessagePartBase {
	id: string;
	messageId: string;
	/** 消息内单调递增，从 0 开始。 */
	seq: number;
	status: PartStatus;
	createdAt: Date;
	updatedAt: Date;
}

/** 判别联合：`type` 与 `content` 形状一一对应，消费端可按 type 收窄。 */
export type MessagePart =
	| (MessagePartBase & { type: "text"; content: TextPartContent })
	| (MessagePartBase & { type: "reasoning"; content: ReasoningPartContent })
	| (MessagePartBase & { type: "tool-call"; content: ToolCallPartContent })
	| (MessagePartBase & {
			type: "tool-result";
			content: ToolResultPartContent;
	  });

export interface MessagePartInput {
	messageId: string;
	type: MessagePartType;
	content: MessagePartContent;
	status: PartStatus;
}

export interface MessagePartPatch {
	content?: MessagePartContent;
	status?: PartStatus;
}

/** 一条消息及其按 seq 升序的 parts。 */
export interface MessageWithParts {
	message: Message;
	parts: MessagePart[];
}
```

- [ ] **Step 2: 在 `packages/agent/src/ports.ts` 增加两个 store 接口**

在文件顶部 import 区（`AgentConfig` import 行下方）增加：
```ts
import type {
	Message,
	MessageInput,
	MessagePart,
	MessagePartInput,
	MessagePartPatch,
	MessagePatch,
	MessageWithParts,
	Session,
	SessionInput,
	SessionStatus,
} from "./session/types";
```

在文件末尾追加两个接口：
```ts
export interface SessionStore {
	create(input: SessionInput): Promise<Session>;
	get(id: string): Promise<Session | null>;
	list(): Promise<Session[]>;
	setStatus(id: string, status: SessionStatus): Promise<void>;
	setTitle(id: string, title: string): Promise<void>;
	/** 📐 P2 compaction 写入。 */
	setSummary(
		id: string,
		summary: string,
		compactedThroughSeq: number
	): Promise<void>;
}

export interface MessageStore {
	createMessage(input: MessageInput): Promise<Message>;
	updateMessage(id: string, patch: MessagePatch): Promise<Message | null>;
	appendPart(input: MessagePartInput): Promise<MessagePart>;
	updatePart(id: string, patch: MessagePartPatch): Promise<MessagePart | null>;
	/** 按 message.seq 升序返回会话全部消息及其 parts（历史回放 + toModelMessages 用）。 */
	listWithParts(sessionId: string): Promise<MessageWithParts[]>;
}
```

- [ ] **Step 3: 在 `packages/agent/package.json` 的 `exports` 增加 `./session/*`**

把 `exports` 改为（新增 `"./session/*"` 一行，其余不动，放在 `./agent/*` 之后）：
```json
  "exports": {
    "./ports": "./src/ports.ts",
    "./agent/*": "./src/agent/*.ts",
    "./session/*": "./src/session/*.ts",
    "./provider/*": "./src/provider/*.ts",
    "./crypto/*": "./src/crypto/*.ts",
    "./testing/*": "./src/testing/*.ts"
  },
```

- [ ] **Step 4: 校验类型 + 提交**

Run: `pnpm -F @better-agent/agent check-types`
Expected: 通过（`TypeScript: No errors found` / 无报错）。
```bash
pnpm fix
git add packages/agent/src/session/types.ts packages/agent/src/ports.ts packages/agent/package.json
git commit -m "feat(agent): add session/message domain types and store ports"
```

---

## Task 2: `sessions`/`messages`/`message_parts` schema + migration

**Files:**
- Create: `packages/db/src/schema/sessions.ts`
- Modify: `packages/db/src/schema/index.ts`

**Interfaces:**
- Consumes: Task 1 的 `session/types.ts` 类型（经 `@better-agent/agent/session/types` 导入，用于 jsonb/text 列的 `$type`）。
- Produces: `schema.sessions` / `schema.messages` / `schema.messageParts` 三个 Drizzle 表，供 Task 3/4 的 store 使用。`messages` 有 `(session_id, seq)` 唯一索引、`message_parts` 有 `(message_id, seq)` 唯一索引。

> 说明：沿用现有 `providers.ts`/`agents.ts` 约定——**不建跨表外键**（`models_cache.provider_id` 也是裸 `text`，无 FK）。`agent_id`/`session_id`/`message_id` 用裸 `uuid` 列。

- [ ] **Step 1: 写 `packages/db/src/schema/sessions.ts`**

```ts
import type {
	FinishReason,
	MessageError,
	MessagePartContent,
	MessagePartType,
	MessageRole,
	MessageStatus,
	MessageUsage,
	PartStatus,
	SessionStatus,
} from "@better-agent/agent/session/types";
import {
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

export const sessions = pgTable("sessions", {
	id: uuid("id").primaryKey().defaultRandom(),
	agentId: uuid("agent_id").notNull(),
	title: text("title"),
	status: text("status").$type<SessionStatus>().notNull().default("active"),
	summary: text("summary"),
	compactedThroughSeq: integer("compacted_through_seq"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const messages = pgTable(
	"messages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sessionId: uuid("session_id").notNull(),
		role: text("role").$type<MessageRole>().notNull(),
		seq: integer("seq").notNull(),
		status: text("status").$type<MessageStatus>().notNull(),
		providerId: text("provider_id"),
		modelId: text("model_id"),
		usage: jsonb("usage").$type<MessageUsage>(),
		finishReason: text("finish_reason").$type<FinishReason>(),
		error: jsonb("error").$type<MessageError>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex("messages_session_seq").on(table.sessionId, table.seq),
	]
);

export const messageParts = pgTable(
	"message_parts",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		messageId: uuid("message_id").notNull(),
		seq: integer("seq").notNull(),
		type: text("type").$type<MessagePartType>().notNull(),
		content: jsonb("content").$type<MessagePartContent>().notNull(),
		status: text("status").$type<PartStatus>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex("message_parts_message_seq").on(table.messageId, table.seq),
	]
);
```

- [ ] **Step 2: 修改 `packages/db/src/schema/index.ts`**

在现有 `export * from "./providers";` 下方增加一行（保持字母序，`sessions` 在 `providers` 之后）：
```ts
export * from "./sessions";
```

- [ ] **Step 3: 生成 migration（pglite 集成测试靠 migrations 建表，必须 generate）**

Run: `pnpm -F @better-agent/db db:generate`
Expected: `packages/db/src/migrations/` 下新增一个含 `CREATE TABLE "sessions"`/`"messages"`/`"message_parts"` 的 `0002_*.sql` 文件 + 更新 `meta/_journal.json` 与新 `meta/0002_snapshot.json`。

> `test-db.ts` 用 `migrate(db, { migrationsFolder })` 建表，不 generate 的话 Task 3/4 集成测试会因「表不存在」失败。

- [ ] **Step 4: 校验类型 + 跑现有 db 测试（确认旧迁移+新表不破坏现有套件）+ 提交**

Run: `pnpm -F @better-agent/db exec tsc --noEmit`
Expected: `TypeScript: No errors found`。
Run: `pnpm -F @better-agent/db test`
Expected: 现有 provider/agent 集成测试全部 PASS（新增的迁移被一起应用，不影响旧表）。
```bash
pnpm fix
git add packages/db/src/schema packages/db/src/migrations
git commit -m "feat(db): add sessions/messages/message_parts schema and migration"
```

---

## Task 3: `SessionStore` Drizzle 实现 + pglite 集成测试

**Files:**
- Create: `packages/db/src/repositories/session-store.ts`
- Test: `packages/db/src/repositories/session-store.integration.test.ts`

**Interfaces:**
- Consumes: `SessionStore` port（Task 1）、`schema.sessions`（Task 2）、`createTestDb`/`TestDb`（既有 `../testing/test-db`）。
- Produces: `createSessionStore(db): SessionStore`，供 Plan 3b 的 server 组装与 sessions 路由使用。

- [ ] **Step 1: 写失败测试 `session-store.integration.test.ts`**

```ts
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createSessionStore } from "./session-store";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

const AGENT_ID = "11111111-1111-1111-1111-111111111111";

it("create returns an active session with id and timestamps", async () => {
	const store = createSessionStore(db);
	const created = await store.create({ agentId: AGENT_ID });
	expect(created.id).toBeTruthy();
	expect(created.agentId).toBe(AGENT_ID);
	expect(created.status).toBe("active");
	expect(created.title).toBeNull();
	expect(created.summary).toBeNull();
	expect(created.compactedThroughSeq).toBeNull();
	expect(created.createdAt).toBeInstanceOf(Date);
});

it("get returns the created session and null for missing id", async () => {
	const store = createSessionStore(db);
	const created = await store.create({ agentId: AGENT_ID });
	expect((await store.get(created.id))?.agentId).toBe(AGENT_ID);
	expect(await store.get("00000000-0000-0000-0000-000000000000")).toBeNull();
});

it("list returns all sessions", async () => {
	const store = createSessionStore(db);
	await store.create({ agentId: AGENT_ID });
	await store.create({ agentId: AGENT_ID });
	expect((await store.list()).length).toBe(2);
});

it("setStatus and setTitle update the row", async () => {
	const store = createSessionStore(db);
	const created = await store.create({ agentId: AGENT_ID });
	await store.setTitle(created.id, "First chat");
	await store.setStatus(created.id, "error");
	const reread = await store.get(created.id);
	expect(reread?.title).toBe("First chat");
	expect(reread?.status).toBe("error");
});

it("setSummary persists summary and compactedThroughSeq", async () => {
	const store = createSessionStore(db);
	const created = await store.create({ agentId: AGENT_ID });
	await store.setSummary(created.id, "summary so far", 4);
	const reread = await store.get(created.id);
	expect(reread?.summary).toBe("summary so far");
	expect(reread?.compactedThroughSeq).toBe(4);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm -F @better-agent/db test src/repositories/session-store.integration.test.ts`
Expected: FAIL（`createSessionStore` 未定义）。

- [ ] **Step 3: 实现 `session-store.ts`**

```ts
import type { SessionStore } from "@better-agent/agent/ports";
import type { Session } from "@better-agent/agent/session/types";
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
type SessionRow = typeof schema.sessions.$inferSelect;

function toSession(row: SessionRow): Session {
	return {
		id: row.id,
		agentId: row.agentId,
		title: row.title,
		status: row.status,
		summary: row.summary,
		compactedThroughSeq: row.compactedThroughSeq,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function createSessionStore(db: Db): SessionStore {
	return {
		async create(input) {
			const rows = await db
				.insert(schema.sessions)
				.values({ agentId: input.agentId })
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create session");
			}
			return toSession(row);
		},
		async get(id) {
			const rows = await db
				.select()
				.from(schema.sessions)
				.where(eq(schema.sessions.id, id))
				.limit(1);
			const row = rows[0];
			return row ? toSession(row) : null;
		},
		async list() {
			const rows = await db.select().from(schema.sessions);
			return rows.map(toSession);
		},
		async setStatus(id, status) {
			await db
				.update(schema.sessions)
				.set({ status, updatedAt: new Date() })
				.where(eq(schema.sessions.id, id));
		},
		async setTitle(id, title) {
			await db
				.update(schema.sessions)
				.set({ title, updatedAt: new Date() })
				.where(eq(schema.sessions.id, id));
		},
		async setSummary(id, summary, compactedThroughSeq) {
			await db
				.update(schema.sessions)
				.set({ summary, compactedThroughSeq, updatedAt: new Date() })
				.where(eq(schema.sessions.id, id));
		},
	};
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm -F @better-agent/db test src/repositories/session-store.integration.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 类型校验 + 提交**

Run: `pnpm -F @better-agent/db exec tsc --noEmit`
Expected: `TypeScript: No errors found`。
```bash
pnpm fix
git add packages/db/src/repositories/session-store.ts packages/db/src/repositories/session-store.integration.test.ts
git commit -m "feat(db): implement session store with pglite integration tests"
```

---

## Task 4: `MessageStore` Drizzle 实现 + pglite 集成测试

**Files:**
- Create: `packages/db/src/repositories/message-store.ts`
- Test: `packages/db/src/repositories/message-store.integration.test.ts`

**Interfaces:**
- Consumes: `MessageStore` port（Task 1）、`schema.messages`/`schema.messageParts`（Task 2）、`createSessionStore`（Task 3，建一个真实 session 拿 sessionId）。
- Produces: `createMessageStore(db): MessageStore`。`createMessage`/`appendPart` 在事务内分配会话内/消息内**从 0 起单调递增的 seq**；`listWithParts` 按 seq 升序返回。

- [ ] **Step 1: 写失败测试 `message-store.integration.test.ts`**

```ts
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createMessageStore } from "./message-store";
import { createSessionStore } from "./session-store";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

const AGENT_ID = "11111111-1111-1111-1111-111111111111";

async function newSessionId(): Promise<string> {
	const session = await createSessionStore(db).create({ agentId: AGENT_ID });
	return session.id;
}

it("createMessage assigns monotonic seq from 0 within a session", async () => {
	const store = createMessageStore(db);
	const sessionId = await newSessionId();
	const first = await store.createMessage({
		sessionId,
		role: "user",
		status: "complete",
		providerId: null,
		modelId: null,
	});
	const second = await store.createMessage({
		sessionId,
		role: "assistant",
		status: "streaming",
		providerId: "openai",
		modelId: "gpt-x",
	});
	expect(first.seq).toBe(0);
	expect(second.seq).toBe(1);
	expect(second.providerId).toBe("openai");
});

it("updateMessage patches status/usage/finishReason and returns null for missing id", async () => {
	const store = createMessageStore(db);
	const sessionId = await newSessionId();
	const created = await store.createMessage({
		sessionId,
		role: "assistant",
		status: "streaming",
		providerId: "openai",
		modelId: "gpt-x",
	});
	const updated = await store.updateMessage(created.id, {
		status: "complete",
		finishReason: "stop",
		usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
	});
	expect(updated?.status).toBe("complete");
	expect(updated?.finishReason).toBe("stop");
	expect(updated?.usage).toEqual({
		inputTokens: 10,
		outputTokens: 20,
		totalTokens: 30,
	});
	expect(
		await store.updateMessage("00000000-0000-0000-0000-000000000000", {
			status: "error",
		})
	).toBeNull();
});

it("appendPart assigns monotonic seq from 0 within a message", async () => {
	const store = createMessageStore(db);
	const sessionId = await newSessionId();
	const message = await store.createMessage({
		sessionId,
		role: "assistant",
		status: "streaming",
		providerId: "openai",
		modelId: "gpt-x",
	});
	const p0 = await store.appendPart({
		messageId: message.id,
		type: "text",
		content: { text: "hello" },
		status: "streaming",
	});
	const p1 = await store.appendPart({
		messageId: message.id,
		type: "text",
		content: { text: " world" },
		status: "complete",
	});
	expect(p0.seq).toBe(0);
	expect(p1.seq).toBe(1);
	expect(p0.type).toBe("text");
});

it("updatePart patches content/status and returns null for missing id", async () => {
	const store = createMessageStore(db);
	const sessionId = await newSessionId();
	const message = await store.createMessage({
		sessionId,
		role: "assistant",
		status: "streaming",
		providerId: "openai",
		modelId: "gpt-x",
	});
	const part = await store.appendPart({
		messageId: message.id,
		type: "text",
		content: { text: "hi" },
		status: "streaming",
	});
	const updated = await store.updatePart(part.id, {
		content: { text: "hi there" },
		status: "complete",
	});
	expect(updated?.content).toEqual({ text: "hi there" });
	expect(updated?.status).toBe("complete");
	expect(
		await store.updatePart("00000000-0000-0000-0000-000000000000", {
			status: "error",
		})
	).toBeNull();
});

it("listWithParts returns messages ordered by seq, each with its parts", async () => {
	const store = createMessageStore(db);
	const sessionId = await newSessionId();
	const user = await store.createMessage({
		sessionId,
		role: "user",
		status: "complete",
		providerId: null,
		modelId: null,
	});
	await store.appendPart({
		messageId: user.id,
		type: "text",
		content: { text: "question" },
		status: "complete",
	});
	const assistant = await store.createMessage({
		sessionId,
		role: "assistant",
		status: "complete",
		providerId: "openai",
		modelId: "gpt-x",
	});
	await store.appendPart({
		messageId: assistant.id,
		type: "text",
		content: { text: "answer" },
		status: "complete",
	});

	const history = await store.listWithParts(sessionId);
	expect(history.map((h) => h.message.role)).toEqual(["user", "assistant"]);
	expect(history[0]?.parts[0]?.content).toEqual({ text: "question" });
	expect(history[1]?.parts[0]?.content).toEqual({ text: "answer" });
});

it("listWithParts returns an empty array for a session with no messages", async () => {
	const store = createMessageStore(db);
	const sessionId = await newSessionId();
	expect(await store.listWithParts(sessionId)).toEqual([]);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm -F @better-agent/db test src/repositories/message-store.integration.test.ts`
Expected: FAIL（`createMessageStore` 未定义）。

- [ ] **Step 3: 实现 `message-store.ts`**

```ts
import type { MessageStore } from "@better-agent/agent/ports";
import type {
	Message,
	MessagePart,
} from "@better-agent/agent/session/types";
import { eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
type MessageRow = typeof schema.messages.$inferSelect;
type PartRow = typeof schema.messageParts.$inferSelect;

const NO_SEQ = -1;

function toMessage(row: MessageRow): Message {
	return {
		id: row.id,
		sessionId: row.sessionId,
		role: row.role,
		seq: row.seq,
		status: row.status,
		providerId: row.providerId,
		modelId: row.modelId,
		usage: row.usage ?? null,
		finishReason: row.finishReason ?? null,
		error: row.error ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

// `type` 与 `content` 是两列独立存储，DB 无法表达二者关联，故在边界做一次断言。
function toMessagePart(row: PartRow): MessagePart {
	return {
		id: row.id,
		messageId: row.messageId,
		seq: row.seq,
		type: row.type,
		content: row.content,
		status: row.status,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	} as MessagePart;
}

function nextSeq(seqs: number[]): number {
	return seqs.reduce((max, seq) => (seq > max ? seq : max), NO_SEQ) + 1;
}

export function createMessageStore(db: Db): MessageStore {
	return {
		createMessage(input) {
			return db.transaction(async (tx) => {
				const existing = await tx
					.select({ seq: schema.messages.seq })
					.from(schema.messages)
					.where(eq(schema.messages.sessionId, input.sessionId));
				const rows = await tx
					.insert(schema.messages)
					.values({ ...input, seq: nextSeq(existing.map((r) => r.seq)) })
					.returning();
				const row = rows[0];
				if (!row) {
					throw new Error("Failed to create message");
				}
				return toMessage(row);
			});
		},
		async updateMessage(id, patch) {
			const rows = await db
				.update(schema.messages)
				.set({ ...patch, updatedAt: new Date() })
				.where(eq(schema.messages.id, id))
				.returning();
			const row = rows[0];
			return row ? toMessage(row) : null;
		},
		appendPart(input) {
			return db.transaction(async (tx) => {
				const existing = await tx
					.select({ seq: schema.messageParts.seq })
					.from(schema.messageParts)
					.where(eq(schema.messageParts.messageId, input.messageId));
				const rows = await tx
					.insert(schema.messageParts)
					.values({ ...input, seq: nextSeq(existing.map((r) => r.seq)) })
					.returning();
				const row = rows[0];
				if (!row) {
					throw new Error("Failed to append message part");
				}
				return toMessagePart(row);
			});
		},
		async updatePart(id, patch) {
			const rows = await db
				.update(schema.messageParts)
				.set({ ...patch, updatedAt: new Date() })
				.where(eq(schema.messageParts.id, id))
				.returning();
			const row = rows[0];
			return row ? toMessagePart(row) : null;
		},
		async listWithParts(sessionId) {
			const messageRows = await db
				.select()
				.from(schema.messages)
				.where(eq(schema.messages.sessionId, sessionId))
				.orderBy(schema.messages.seq);
			if (messageRows.length === 0) {
				return [];
			}
			const partRows = await db
				.select()
				.from(schema.messageParts)
				.where(
					inArray(
						schema.messageParts.messageId,
						messageRows.map((m) => m.id)
					)
				)
				.orderBy(schema.messageParts.seq);
			return messageRows.map((message) => ({
				message: toMessage(message),
				parts: partRows
					.filter((part) => part.messageId === message.id)
					.map(toMessagePart),
			}));
		},
	};
}
```

> 说明：① `nextSeq` 在事务内 `select` 现有 seq 再 `+1`，单实例 + 每会话串行运行（Plan 3b 的运行时约束）下不竞争；`(session_id, seq)`/`(message_id, seq)` 唯一索引兜底，并发冲突会抛错而非静默写脏。② `toMessagePart` 的一次 `as MessagePart` 是 DB 边界必要断言（两列无法在类型上关联），是此文件唯一断言。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm -F @better-agent/db test src/repositories/message-store.integration.test.ts`
Expected: PASS（6 个用例）。

- [ ] **Step 5: 类型校验 + 提交**

Run: `pnpm -F @better-agent/db exec tsc --noEmit`
Expected: `TypeScript: No errors found`。
```bash
pnpm fix
git add packages/db/src/repositories/message-store.ts packages/db/src/repositories/message-store.integration.test.ts
git commit -m "feat(db): implement message store with pglite integration tests"
```

---

## Task 5: 转换层 `toModelMessages`（纯函数）+ 单测

**Files:**
- Create: `packages/agent/src/session/to-model-messages.ts`
- Test: `packages/agent/src/session/to-model-messages.test.ts`

**Interfaces:**
- Consumes: `MessageWithParts`（Task 1）、`ModelMessage`（`ai` 包）。
- Produces: `toModelMessages(input: ToModelMessagesInput): ModelMessage[]`，供 Plan 3b 的 `runTurn` 在每轮拼上下文时调用。`ToModelMessagesInput = { systemPrompt: string; summary: string | null; compactedThroughSeq: number | null; history: MessageWithParts[] }`。

> 规则（spec 第 6 节）：① 最前一条 `system` = agent 的 `systemPrompt`；② 📐 若 `summary` 非 null：再拼一条 `system`「对话摘要：…」，且只纳入 `seq > compactedThroughSeq` 的消息；③ 每条 user/assistant 消息把其 `text`/`reasoning` parts 的文本按 `\n` 拼成 content；④ 历史里的 `system` 消息跳过（system prompt 已在最前）。**本期不映射 tool-call/tool-result parts**（P1 不产生；工具阶段再加）。

- [ ] **Step 1: 写失败测试 `to-model-messages.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { toModelMessages } from "./to-model-messages";
import type { MessageWithParts } from "./types";

const NOW = new Date("2026-06-16T00:00:00Z");

function entry(
	role: "user" | "assistant" | "system",
	seq: number,
	text: string
): MessageWithParts {
	return {
		message: {
			id: `msg-${seq}`,
			sessionId: "s",
			role,
			seq,
			status: "complete",
			providerId: null,
			modelId: null,
			usage: null,
			finishReason: null,
			error: null,
			createdAt: NOW,
			updatedAt: NOW,
		},
		parts: [
			{
				id: `part-${seq}`,
				messageId: `msg-${seq}`,
				seq: 0,
				type: "text",
				content: { text },
				status: "complete",
				createdAt: NOW,
				updatedAt: NOW,
			},
		],
	};
}

describe("toModelMessages", () => {
	it("prepends the system prompt then maps user/assistant turns", () => {
		const result = toModelMessages({
			systemPrompt: "You are helpful.",
			summary: null,
			compactedThroughSeq: null,
			history: [entry("user", 0, "hi"), entry("assistant", 1, "hello")],
		});
		expect(result).toEqual([
			{ role: "system", content: "You are helpful." },
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "hello" },
		]);
	});

	it("joins textual parts (text + reasoning) with newlines", () => {
		const withParts: MessageWithParts = {
			message: entry("assistant", 0, "").message,
			parts: [
				{
					id: "p0",
					messageId: "msg-0",
					seq: 0,
					type: "reasoning",
					content: { text: "line1" },
					status: "complete",
					createdAt: NOW,
					updatedAt: NOW,
				},
				{
					id: "p1",
					messageId: "msg-0",
					seq: 1,
					type: "text",
					content: { text: "line2" },
					status: "complete",
					createdAt: NOW,
					updatedAt: NOW,
				},
			],
		};
		const result = toModelMessages({
			systemPrompt: "S",
			summary: null,
			compactedThroughSeq: null,
			history: [withParts],
		});
		expect(result[1]).toEqual({ role: "assistant", content: "line1\nline2" });
	});

	it("with a summary, prepends it and drops messages at or before compactedThroughSeq", () => {
		const result = toModelMessages({
			systemPrompt: "S",
			summary: "earlier talk",
			compactedThroughSeq: 1,
			history: [
				entry("user", 0, "old"),
				entry("assistant", 1, "older"),
				entry("user", 2, "new"),
			],
		});
		expect(result).toEqual([
			{ role: "system", content: "S" },
			{ role: "system", content: "对话摘要：earlier talk" },
			{ role: "user", content: "new" },
		]);
	});

	it("skips system messages found in history", () => {
		const result = toModelMessages({
			systemPrompt: "S",
			summary: null,
			compactedThroughSeq: null,
			history: [entry("system", 0, "ignored"), entry("user", 1, "hi")],
		});
		expect(result).toEqual([
			{ role: "system", content: "S" },
			{ role: "user", content: "hi" },
		]);
	});
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm -F @better-agent/agent test src/session/to-model-messages.test.ts`
Expected: FAIL（`toModelMessages` 未定义）。

- [ ] **Step 3: 实现 `to-model-messages.ts`**

```ts
import type { ModelMessage } from "ai";
import type { MessageWithParts } from "./types";

export interface ToModelMessagesInput {
	systemPrompt: string;
	/** 📐 P2 compaction：非 null 时前置摘要并只纳入 seq > compactedThroughSeq 的消息。 */
	summary: string | null;
	compactedThroughSeq: number | null;
	/** 按 seq 升序的会话历史。 */
	history: MessageWithParts[];
}

const NO_COMPACTION = -1;

/** 拼接一条消息的 text/reasoning parts 文本；tool-* parts 本期忽略。 */
function toTextContent(entry: MessageWithParts): string {
	const texts: string[] = [];
	for (const part of entry.parts) {
		if (part.type === "text" || part.type === "reasoning") {
			texts.push(part.content.text);
		}
	}
	return texts.join("\n");
}

export function toModelMessages(input: ToModelMessagesInput): ModelMessage[] {
	const result: ModelMessage[] = [
		{ role: "system", content: input.systemPrompt },
	];

	let history = input.history;
	if (input.summary !== null) {
		result.push({ role: "system", content: `对话摘要：${input.summary}` });
		const through = input.compactedThroughSeq ?? NO_COMPACTION;
		history = history.filter((entry) => entry.message.seq > through);
	}

	for (const entry of history) {
		const content = toTextContent(entry);
		if (entry.message.role === "user") {
			result.push({ role: "user", content });
		} else if (entry.message.role === "assistant") {
			result.push({ role: "assistant", content });
		}
		// 历史里的 system 消息跳过：systemPrompt 已在最前，摘要单独处理。
	}
	return result;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm -F @better-agent/agent test src/session/to-model-messages.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 5: 全包测试 + 类型校验 + 提交**

Run: `pnpm -F @better-agent/agent test`
Expected: 全部 PASS（含既有 16 例 + 新 4 例）。
Run: `pnpm -F @better-agent/agent check-types`
Expected: 通过。
```bash
pnpm fix
git add packages/agent/src/session/to-model-messages.ts packages/agent/src/session/to-model-messages.test.ts
git commit -m "feat(agent): add toModelMessages conversion for session history"
```

---

## Self-Review（计划作者自检结论）

- **Spec 覆盖**：覆盖 spec 第 5 节（`sessions`/`messages`/`message_parts` 三表全字段，Task 2；含 📐 `summary`/`compactedThroughSeq` 列、tool-* part 形状）+ 第 6 节（`toModelMessages` 的 system prompt 拼接、📐 摘要分支、text/reasoning 映射、Task 5）。第 7–8 节（`runTurn` + 流式 + 增量落库）与第 11 节 `sessions` 路由**显式划归 Plan 3b**，已在 Global Constraints 标注范围边界，非遗漏。
- **占位扫描**：无 TBD/“稍后实现”；每步含完整代码或精确命令与期望输出。
- **类型一致性**：`Session`/`Message`/`MessagePart`/`MessageWithParts`/`MessageInput`/`MessagePatch`/`MessagePartInput`/`MessagePartPatch`（Task 1）在 Task 2（schema `$type<...>`）、Task 3（`toSession` 返回 `Session`）、Task 4（`toMessage`/`toMessagePart`、`createMessage` 收 `MessageInput`、`updateMessage` 收 `MessagePatch`、`listWithParts` 返回 `MessageWithParts[]`）、Task 5（`ToModelMessagesInput.history: MessageWithParts[]`，按 `message.role`/`part.type` 收窄）一致使用；`SessionStore`/`MessageStore`（Task 1 port）方法签名在 Task 3/4 实现处逐一对应（`create`/`get`/`list`/`setStatus`/`setTitle`/`setSummary`；`createMessage`/`updateMessage`/`appendPart`/`updatePart`/`listWithParts`）。
- **已知风险**：① seq 用「事务内 select max +1」分配，依赖 Plan 3b 的单实例 + 每会话串行；`(session_id,seq)`/`(message_id,seq)` 唯一索引兜底并发。② 集成测试靠 migrations，Task 2 必须 `db:generate` 否则 Task 3/4 因「表不存在」失败（已在 Task 2 Step 3 标注）。③ `toMessagePart` 含一次 `as MessagePart` 边界断言（`type`/`content` 两列无法在类型层关联）；若 biome 报 `noExplicitAny` 之外的断言告警，可改为按 `row.type` 的 `switch` 构造，语义不变。④ `MessagePatch`/`MessagePartPatch` 经 `db.set({ ...patch, updatedAt })` 写入，`undefined` 字段被 Drizzle 忽略、显式 `null` 正常落库（符合 jsonb 可空语义）。⑤ db 包无 `check-types` 脚本，本计划用 `pnpm -F @better-agent/db exec tsc --noEmit` 作类型门禁（已验证可用）。
