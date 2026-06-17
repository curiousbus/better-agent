# Plan 2: Agent 配置（agents CRUD + provider→model 校验）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 1 的 provider/模型注册表之上，实现「可配置 agent」：`agents` 表（name/description/systemPrompt/provider/model/params）、Drizzle 存储、创建/更新时校验 provider 有 enabled 凭证且 model 在 `models_cache`，并通过 oRPC `agents` 路由暴露 CRUD。

**Architecture:** 沿用 Plan 1 的「隔离运行时 + 依赖注入」。`packages/agent` 定义 `AgentConfig` 领域类型、`AgentStore` port、纯逻辑 `AgentValidator`（依赖已有的 `ProviderCredentialStore`/`ModelCacheStore` 两个 port）；`packages/db` 用 Drizzle 实现 `AgentStore`；`packages/api` 的 `agents` 路由组合校验 + 存储；`apps/server` 注入实例。详见 `docs/superpowers/specs/2026-06-16-agent-runtime-design.md` 第 4 节、第 11 节。

**Tech Stack:** TypeScript(ESM, strict) · Vitest · PGlite(集成测试) · Zod · Drizzle(node-postgres) · oRPC。

> 约定：每个 commit 前先跑 `pnpm fix`（biome 自动修复）再提交；仓库禁止 `^`/`~`/`latest` 版本，安装一律用 `pnpm add -E`。文件名 kebab-case。函数 ≤50 行、圈复杂度 ≤10、禁 `any`/`console`。
>
> **范围**：本计划是 P1 拆分的第 2 块（Plan 1 = provider/模型注册表）。Session/Message/运行时循环（spec 第 5–8 节）= Plan 3；Client SDK（第 13 节）= Plan 4；admin 后台 = Plan 5。本计划只交付 agent 配置 CRUD，agent 暂不可运行（运行属 Plan 3）。

---

## 文件结构

**Create:**
- `packages/agent/src/agent/types.ts` — agent 领域类型（`AgentParams`/`AgentConfig`/`AgentInput`）
- `packages/agent/src/agent/agent-validator.ts` — 纯逻辑校验器（provider 有 enabled 凭证 + model 在 cache）
- `packages/agent/src/agent/agent-validator.test.ts`
- `packages/db/src/schema/agents.ts` — `agents` 表
- `packages/db/src/repositories/agent-store.ts` — `AgentStore` 的 Drizzle 实现
- `packages/db/src/repositories/agent-store.integration.test.ts` — pglite 集成测试
- `packages/api/src/routers/agents.ts` — oRPC `agents` 路由

**Modify:**
- `packages/agent/src/ports.ts` — 增加 `AgentStore` 接口
- `packages/agent/package.json` — `exports` 增加 `"./agent/*"`
- `packages/db/src/schema/index.ts` — 导出 `agents` schema
- `packages/api/src/services.ts` — `AgentServices` 增加 `agentValidator` 与 `stores.agent`
- `packages/api/src/routers/index.ts` — 挂载 `agents` 路由
- `apps/server/src/index.ts` — 组装 `agentStore` + `agentValidator` 注入 context

---

## Task 1: agent 领域类型 + AgentStore port + 包导出

**Files:**
- Create: `packages/agent/src/agent/types.ts`
- Modify: `packages/agent/src/ports.ts`, `packages/agent/package.json`

- [ ] **Step 1: 写 `packages/agent/src/agent/types.ts`（领域类型，无逻辑、无测试）**

```ts
export interface AgentParams {
	temperature: number | null;
	topP: number | null;
	maxOutputTokens: number | null;
}

export interface AgentConfig {
	id: string;
	name: string;
	description: string;
	systemPrompt: string;
	providerId: string;
	modelId: string;
	params: AgentParams | null;
	createdAt: Date;
	updatedAt: Date;
}

/** 创建/更新输入：无 id、无时间戳（由存储层生成）。 */
export interface AgentInput {
	name: string;
	description: string;
	systemPrompt: string;
	providerId: string;
	modelId: string;
	params: AgentParams | null;
}
```

- [ ] **Step 2: 在 `packages/agent/src/ports.ts` 增加 `AgentStore` 接口**

在文件顶部 import 区增加：
```ts
import type { AgentConfig, AgentInput } from "./agent/types";
```

在文件末尾追加接口：
```ts
export interface AgentStore {
	create(input: AgentInput): Promise<AgentConfig>;
	delete(id: string): Promise<void>;
	get(id: string): Promise<AgentConfig | null>;
	list(): Promise<AgentConfig[]>;
	update(id: string, input: AgentInput): Promise<AgentConfig | null>;
}
```

- [ ] **Step 3: 在 `packages/agent/package.json` 的 `exports` 增加 `./agent/*`**

把 `exports` 改为（新增 `"./agent/*"` 一行，其余不动）：
```json
  "exports": {
    "./ports": "./src/ports.ts",
    "./agent/*": "./src/agent/*.ts",
    "./provider/*": "./src/provider/*.ts",
    "./crypto/*": "./src/crypto/*.ts",
    "./testing/*": "./src/testing/*.ts"
  },
```

- [ ] **Step 4: 校验类型 + 提交**

Run: `pnpm -F @better-agent/agent check-types`
Expected: 通过（无报错）。
```bash
pnpm fix
git add packages/agent
git commit -m "feat(agent): add agent config domain types and store port"
```

---

## Task 2: agent 校验器 `agent-validator`

> 纯逻辑：依赖 Plan 1 已有的 `ProviderCredentialStore`/`ModelCacheStore`。`validate` 返回 `null` 表示合法，返回 `string` 表示错误原因（路由层据此转 `BAD_REQUEST`）。不抛异常，便于单测与组合。

**Files:**
- Create: `packages/agent/src/agent/agent-validator.ts`
- Test: `packages/agent/src/agent/agent-validator.test.ts`

- [ ] **Step 1: 写失败测试 `agent-validator.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
	createFakeCredentialStore,
	createFakeModelStore,
} from "../testing/fakes";
import { createAgentValidator } from "./agent-validator";

function setup() {
	const modelStore = createFakeModelStore();
	const credentialStore = createFakeCredentialStore([
		{ providerId: "openai", apiKey: "sk-1", baseURL: null, enabled: true },
	]);
	return { modelStore, credentialStore };
}

const MODEL = {
	providerId: "openai",
	modelId: "gpt-x",
	name: "GPT-X",
	contextLimit: 1000,
	maxOutputTokens: 100,
	inputPricePerM: 1,
	outputPricePerM: 2,
	capabilities: { toolCall: true, reasoning: false, vision: false },
};

describe("createAgentValidator", () => {
	it("returns null when provider has enabled credential and model exists", async () => {
		const { modelStore, credentialStore } = setup();
		await modelStore.replaceAll([MODEL]);
		const validator = createAgentValidator({ credentialStore, modelStore });
		expect(await validator.validate({ providerId: "openai", modelId: "gpt-x" })).toBeNull();
	});

	it("rejects when provider has no credential", async () => {
		const { modelStore } = setup();
		await modelStore.replaceAll([MODEL]);
		const validator = createAgentValidator({
			credentialStore: createFakeCredentialStore(),
			modelStore,
		});
		const error = await validator.validate({ providerId: "openai", modelId: "gpt-x" });
		expect(error).toMatch(/credential/i);
	});

	it("rejects when credential is disabled", async () => {
		const { modelStore } = setup();
		await modelStore.replaceAll([MODEL]);
		const validator = createAgentValidator({
			credentialStore: createFakeCredentialStore([
				{ providerId: "openai", apiKey: "sk-1", baseURL: null, enabled: false },
			]),
			modelStore,
		});
		const error = await validator.validate({ providerId: "openai", modelId: "gpt-x" });
		expect(error).toMatch(/credential/i);
	});

	it("rejects when model is not in the catalog", async () => {
		const { modelStore, credentialStore } = setup();
		await modelStore.replaceAll([MODEL]);
		const validator = createAgentValidator({ credentialStore, modelStore });
		const error = await validator.validate({ providerId: "openai", modelId: "nope" });
		expect(error).toMatch(/model/i);
	});
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm -F @better-agent/agent test src/agent/agent-validator.test.ts`
Expected: FAIL（`createAgentValidator` 未定义）。

- [ ] **Step 3: 实现 `agent-validator.ts`**

```ts
import type { ModelCacheStore, ProviderCredentialStore } from "../ports";

export interface AgentValidatorDeps {
	credentialStore: ProviderCredentialStore;
	modelStore: ModelCacheStore;
}

export interface AgentValidatorInput {
	providerId: string;
	modelId: string;
}

export interface AgentValidator {
	/** 返回 null 表示合法；返回错误原因字符串表示不合法。 */
	validate(input: AgentValidatorInput): Promise<string | null>;
}

export function createAgentValidator(deps: AgentValidatorDeps): AgentValidator {
	return {
		async validate({ providerId, modelId }) {
			const credential = await deps.credentialStore.get(providerId);
			if (!(credential && credential.enabled)) {
				return `Provider "${providerId}" has no enabled credential`;
			}
			const model = await deps.modelStore.get(providerId, modelId);
			if (!model) {
				return `Model "${modelId}" is not in the catalog for provider "${providerId}"`;
			}
			return null;
		},
	};
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm -F @better-agent/agent test src/agent/agent-validator.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 5: 全包测试 + 提交**

Run: `pnpm -F @better-agent/agent test`
Expected: 全部 PASS。
```bash
pnpm fix
git add packages/agent/src/agent
git commit -m "feat(agent): add agent validator for provider/model checks"
```

---

## Task 3: `agents` Drizzle schema + migration

**Files:**
- Create: `packages/db/src/schema/agents.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: 写 `packages/db/src/schema/agents.ts`**

```ts
import type { AgentParams } from "@better-agent/agent/agent/types";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const agents = pgTable("agents", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	description: text("description").notNull(),
	systemPrompt: text("system_prompt").notNull(),
	providerId: text("provider_id").notNull(),
	modelId: text("model_id").notNull(),
	params: jsonb("params").$type<AgentParams>(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
```

- [ ] **Step 2: 修改 `packages/db/src/schema/index.ts`**

在现有 `export * from "./providers";` 下方增加一行：
```ts
export * from "./agents";
```

- [ ] **Step 3: 生成 migration（pglite 集成测试靠 migrations 建表，必须 generate）**

Run: `pnpm -F @better-agent/db db:generate`
Expected: `packages/db/src/migrations/` 下新增一个含 `CREATE TABLE "agents"` 的 `.sql` 文件 + 更新 `_journal.json`。

> 说明：`test-db.ts` 用 `migrate(db, { migrationsFolder })` 建表，所以不 generate 的话 Task 4 的集成测试会因「表不存在」失败。

- [ ] **Step 4: 校验类型 + 提交**

Run: `pnpm -F @better-agent/db check-types`
Expected: 通过。
```bash
pnpm fix
git add packages/db/src/schema packages/db/src/migrations
git commit -m "feat(db): add agents table schema and migration"
```

---

## Task 4: `AgentStore` Drizzle 实现 + pglite 集成测试

**Files:**
- Create: `packages/db/src/repositories/agent-store.ts`
- Test: `packages/db/src/repositories/agent-store.integration.test.ts`

- [ ] **Step 1: 写失败测试 `agent-store.integration.test.ts`**

```ts
import { afterEach, beforeEach, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createAgentStore } from "./agent-store";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

const INPUT = {
	name: "Helper",
	description: "A helpful agent",
	systemPrompt: "You are helpful.",
	providerId: "anthropic",
	modelId: "claude-opus-4-5",
	params: null,
};

it("create returns a row with generated id and timestamps", async () => {
	const store = createAgentStore(db);
	const created = await store.create(INPUT);
	expect(created.id).toBeTruthy();
	expect(created.name).toBe("Helper");
	expect(created.params).toBeNull();
	expect(created.createdAt).toBeInstanceOf(Date);
});

it("get returns the created agent and null for missing id", async () => {
	const store = createAgentStore(db);
	const created = await store.create(INPUT);
	expect((await store.get(created.id))?.name).toBe("Helper");
	expect(await store.get("00000000-0000-0000-0000-000000000000")).toBeNull();
});

it("list returns all agents", async () => {
	const store = createAgentStore(db);
	await store.create(INPUT);
	await store.create({ ...INPUT, name: "Second" });
	expect((await store.list()).length).toBe(2);
});

it("update changes fields and returns null for missing id", async () => {
	const store = createAgentStore(db);
	const created = await store.create(INPUT);
	const updated = await store.update(created.id, {
		...INPUT,
		name: "Renamed",
		params: { temperature: 0.5, topP: null, maxOutputTokens: 2000 },
	});
	expect(updated?.name).toBe("Renamed");
	expect(updated?.params).toEqual({ temperature: 0.5, topP: null, maxOutputTokens: 2000 });
	expect(await store.update("00000000-0000-0000-0000-000000000000", INPUT)).toBeNull();
});

it("delete removes the agent", async () => {
	const store = createAgentStore(db);
	const created = await store.create(INPUT);
	await store.delete(created.id);
	expect(await store.get(created.id)).toBeNull();
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm -F @better-agent/db test src/repositories/agent-store.integration.test.ts`
Expected: FAIL（`createAgentStore` 未定义）。

- [ ] **Step 3: 实现 `agent-store.ts`**

```ts
import type { AgentStore } from "@better-agent/agent/ports";
import type { AgentConfig } from "@better-agent/agent/agent/types";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";

type AgentRow = typeof schema.agents.$inferSelect;
type Db = NodePgDatabase<typeof schema>;

function toAgentConfig(row: AgentRow): AgentConfig {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		systemPrompt: row.systemPrompt,
		providerId: row.providerId,
		modelId: row.modelId,
		params: row.params ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function createAgentStore(db: Db): AgentStore {
	return {
		async create(input) {
			const rows = await db.insert(schema.agents).values(input).returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create agent");
			}
			return toAgentConfig(row);
		},
		async get(id) {
			const rows = await db
				.select()
				.from(schema.agents)
				.where(eq(schema.agents.id, id))
				.limit(1);
			const row = rows[0];
			return row ? toAgentConfig(row) : null;
		},
		async list() {
			const rows = await db.select().from(schema.agents);
			return rows.map(toAgentConfig);
		},
		async update(id, input) {
			const rows = await db
				.update(schema.agents)
				.set({ ...input, updatedAt: new Date() })
				.where(eq(schema.agents.id, id))
				.returning();
			const row = rows[0];
			return row ? toAgentConfig(row) : null;
		},
		async delete(id) {
			await db.delete(schema.agents).where(eq(schema.agents.id, id));
		},
	};
}
```

> 说明：`createAgentStore` 形参类型用 `NodePgDatabase`，pglite 的 `PgliteDatabase` 在测试中结构兼容（Plan 1 的 provider-stores 同样如此）。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm -F @better-agent/db test src/repositories/agent-store.integration.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 提交**

```bash
pnpm fix
git add packages/db/src/repositories
git commit -m "feat(db): implement agent store with pglite integration tests"
```

---

## Task 5: oRPC `agents` 路由 + 服务注入

**Files:**
- Create: `packages/api/src/routers/agents.ts`
- Modify: `packages/api/src/services.ts`, `packages/api/src/routers/index.ts`

- [ ] **Step 1: 在 `packages/api/src/services.ts` 增加 `agentValidator` 与 `stores.agent`**

把文件改为：
```ts
import type { AgentValidator } from "@better-agent/agent/agent/agent-validator";
import type {
	AgentStore,
	ModelCacheStore,
	ProviderCatalogStore,
	ProviderCredentialStore,
} from "@better-agent/agent/ports";
import type { ModelCatalog } from "@better-agent/agent/provider/model-catalog";
import type { ModelFactory } from "@better-agent/agent/provider/model-factory";

export interface AgentServices {
	catalog: ModelCatalog;
	modelFactory: ModelFactory;
	agentValidator: AgentValidator;
	stores: {
		providerCatalog: ProviderCatalogStore;
		modelCache: ModelCacheStore;
		providerCredential: ProviderCredentialStore;
		agent: AgentStore;
	};
}
```

- [ ] **Step 2: 写 `packages/api/src/routers/agents.ts`**

```ts
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { publicProcedure } from "../index";

const paramsInput = z.object({
	temperature: z.number().min(0).max(2).nullable().default(null),
	topP: z.number().min(0).max(1).nullable().default(null),
	maxOutputTokens: z.number().int().positive().nullable().default(null),
});

const agentInput = z.object({
	name: z.string().min(1),
	description: z.string().min(1),
	systemPrompt: z.string().min(1),
	providerId: z.string().min(1),
	modelId: z.string().min(1),
	params: paramsInput.nullable().default(null),
});

const idInput = z.object({ id: z.uuid() });

export const agentsRouter = {
	list: publicProcedure.handler(({ context }) =>
		context.services.stores.agent.list()
	),

	get: publicProcedure.input(idInput).handler(({ input, context }) =>
		context.services.stores.agent.get(input.id)
	),

	create: publicProcedure
		.input(agentInput)
		.handler(async ({ input, context }) => {
			const error = await context.services.agentValidator.validate(input);
			if (error) {
				throw new ORPCError("BAD_REQUEST", { message: error });
			}
			return context.services.stores.agent.create(input);
		}),

	update: publicProcedure
		.input(idInput.extend(agentInput.shape))
		.handler(async ({ input, context }) => {
			const { id, ...rest } = input;
			const error = await context.services.agentValidator.validate(rest);
			if (error) {
				throw new ORPCError("BAD_REQUEST", { message: error });
			}
			const updated = await context.services.stores.agent.update(id, rest);
			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: `Agent ${id} not found` });
			}
			return updated;
		}),

	delete: publicProcedure
		.input(idInput)
		.handler(async ({ input, context }) => {
			await context.services.stores.agent.delete(input.id);
			return { ok: true };
		}),
};
```

- [ ] **Step 3: 挂载到 `packages/api/src/routers/index.ts`**

把文件改为（新增 `agents` import 与挂载，其余不动）：
```ts
import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { agentsRouter } from "./agents";
import { providersRouter } from "./providers";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => "OK"),
	providers: providersRouter,
	agents: agentsRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
```

- [ ] **Step 4: 校验类型 + 提交**

Run: `pnpm -F @better-agent/api check-types`
Expected: 通过。
```bash
pnpm fix
git add packages/api
git commit -m "feat(api): add agents router with provider/model validation"
```

---

## Task 6: 组装到 `apps/server` + 端到端验证

**Files:**
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: 在 `apps/server/src/index.ts` 组装 `agentStore` + `agentValidator`**

在 import 区增加：
```ts
import { createAgentValidator } from "@better-agent/agent/agent/agent-validator";
import { createAgentStore } from "@better-agent/db/repositories/agent-store";
```

在 `buildServices()` 内，于 `providerCredential` 之后、`return` 之前增加：
```ts
	const agent = createAgentStore(db);
	const agentValidator = createAgentValidator({
		credentialStore: providerCredential,
		modelStore: modelCache,
	});
```

把 `return { ... }` 改为同时包含 `agentValidator` 与 `stores.agent`：
```ts
	return {
		catalog: createModelCatalog({
			catalogStore: providerCatalog,
			modelStore: modelCache,
			fetcher: () => fetchModelsDev(env.MODELS_DEV_URL),
		}),
		modelFactory: createModelFactory({
			catalogStore: providerCatalog,
			credentialStore: providerCredential,
		}),
		agentValidator,
		stores: { providerCatalog, modelCache, providerCredential, agent },
	};
```

- [ ] **Step 2: 全仓库校验类型**

Run: `pnpm check-types`
Expected: 全部通过。

- [ ] **Step 3: 端到端手动验证（需 postgres 在跑、agents migration 已应用）**

先把新表推到本地库并启动 server：
```bash
pnpm db:start
pnpm -F @better-agent/db db:push
pnpm -F server dev
```
另开终端，先刷新 catalog 与写一个真实凭证（agent 校验需要 enabled 凭证 + model 在 cache）：
```bash
curl -s -X POST localhost:3000/rpc/providers/catalogRefresh -d '{}'
curl -s -X POST localhost:3000/rpc/providers/credentialsUpsert -H 'content-type: application/json' \
  -d '{"json":{"providerId":"anthropic","apiKey":"sk-ant-REAL-OR-DUMMY","baseURL":null,"enabled":true}}'
```
然后创建 / 列出 / 校验失败路径：
```bash
# 合法创建（provider 有凭证、model 在 cache）→ 返回带 id 的 agent
curl -s -X POST localhost:3000/rpc/agents/create -H 'content-type: application/json' \
  -d '{"json":{"name":"Helper","description":"helps","systemPrompt":"You are helpful.","providerId":"anthropic","modelId":"claude-opus-4-5","params":null}}'
# 列表
curl -s -X POST localhost:3000/rpc/agents/list -d '{}'
# 校验失败：model 不在 cache → BAD_REQUEST
curl -s -X POST localhost:3000/rpc/agents/create -H 'content-type: application/json' \
  -d '{"json":{"name":"Bad","description":"x","systemPrompt":"x","providerId":"anthropic","modelId":"no-such-model","params":null}}'
```
Expected:
- 合法创建返回 `{"json":{"id":"<uuid>","name":"Helper",...}}`；
- `list` 返回含该 agent 的数组；
- 非法 model 返回 oRPC `BAD_REQUEST` 错误（message 含 "not in the catalog"）。

> 路径形式 `/rpc/<router>/<procedure>`；若不确定，用 web 端 oRPC client 调 `orpc.agents.create(...)` 验证更稳妥。

- [ ] **Step 4: 提交**

```bash
pnpm fix
git add apps/server
git commit -m "feat(server): assemble agent store and validator into context"
```

---

## Self-Review（计划作者自检结论）

- **Spec 覆盖**：覆盖 spec 第 4 节全部 —— `agents` 表字段（id/name/description/systemPrompt/providerId/modelId/params/时间戳，Task 3）、MVP 必填校验（Task 5 zod `min(1)`）、provider 须有 enabled 凭证 + model 须在 `models_cache`（Task 2 validator + Task 5 路由）、第 11 节 `agents` 路由 `list/get/create/update/delete`（Task 5）。spec 第 4 节「预留不建列」`toolPolicy/permissions/subagents` 本计划遵守（不建）；「模型失效仍可运行」属运行期（Plan 3），本计划只在创建/更新时校验，符合分层。
- **占位扫描**：无 TBD/“稍后实现”；每个改动步骤含完整代码或精确命令。
- **类型一致性**：`AgentConfig/AgentInput/AgentParams`（Task 1）在 Task 3（schema `$type<AgentParams>`）、Task 4（`toAgentConfig` 返回 `AgentConfig`、`create/update` 收 `AgentInput`）、Task 5（zod `agentInput` 形状与 `AgentInput` 字段一致）一致使用；`AgentStore`（Task 1 port）在 Task 4 实现、Task 5/6 注入签名一致；`AgentValidator.validate` 返回 `string | null`（Task 2）在 Task 5 路由按 `if (error) throw BAD_REQUEST` 消费一致。
- **已知风险**：① `agents.id` 用 `uuid().defaultRandom()`，依赖 postgres 内置 `gen_random_uuid()`（pg13+/pglite 均支持）；② 集成测试靠 migrations，Task 3 必须 `db:generate` 否则 Task 4 失败（已在 Task 3 Step 3 标注）；③ `update` 路由用 `idInput.extend(agentInput.shape)` 合并 id 与 agent 字段，oRPC/zod v4 下 `.extend(shape)` 可用；若类型不通过，改为 `z.object({ id: z.uuid(), ...agentInput.shape })`。
