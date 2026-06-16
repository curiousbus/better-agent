# Plan 1: 基础设施 + Provider/模型注册表 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭好 `packages/agent` 运行时骨架，实现「完全数据驱动」的 Provider/模型注册表：从 models.dev 同步 provider+模型目录、加密存储 provider 凭证、动态加载 AI SDK 适配器构建可用的 `LanguageModel`，并通过 oRPC `providers` 路由暴露给上层。

**Architecture:** 隔离运行时 + 依赖注入。`packages/agent` 只含纯逻辑，通过 `ports.ts` 接口依赖存储；`packages/db` 用 Drizzle 反向实现这些接口；`packages/api` 的 oRPC `providers` 路由把它们组合；`apps/server` 注入实例。详见 `docs/superpowers/specs/2026-06-16-agent-runtime-design.md` 第 2–3、11 节。

**Tech Stack:** TypeScript(ESM, strict) · Vitest · Zod · Drizzle(node-postgres) · Vercel AI SDK(`ai` + `@ai-sdk/*`) · oRPC · node:crypto(aes-256-gcm)。

> 约定：每个 commit 前先跑 `pnpm fix`（biome 自动修复）再提交；仓库禁止 `^`/`~`/`latest` 版本，安装一律用 `pnpm add -E`。文件名 kebab-case。函数 ≤50 行、圈复杂度 ≤10、禁 `any`/`console`。

---

## 文件结构

**Create:**
- `packages/agent/package.json` — 运行时包清单
- `packages/agent/tsconfig.json` — 继承 base
- `packages/agent/vitest.config.ts` — 测试配置
- `packages/agent/src/provider/types.ts` — provider/model 领域类型
- `packages/agent/src/ports.ts` — 存储接口（本计划只含 provider 相关）
- `packages/agent/src/crypto/secret-box.ts` — 对称加解密
- `packages/agent/src/crypto/secret-box.test.ts`
- `packages/agent/src/provider/models-dev.ts` — 拉取+解析 models.dev
- `packages/agent/src/provider/models-dev.test.ts`
- `packages/agent/src/provider/model-catalog.ts` — 同步目录到存储
- `packages/agent/src/provider/model-catalog.test.ts`
- `packages/agent/src/provider/adapter-loader.ts` — 动态加载 AI SDK 适配器
- `packages/agent/src/provider/adapter-loader.test.ts`
- `packages/agent/src/provider/model-factory.ts` — 构建 LanguageModel
- `packages/agent/src/provider/model-factory.test.ts`
- `packages/agent/src/testing/fakes.ts` — 内存版存储（测试用）
- `packages/db/src/schema/providers.ts` — 三张表
- `packages/db/src/repositories/provider-stores.ts` — ports 的 Drizzle 实现
- `packages/db/src/repositories/provider-stores.integration.test.ts`
- `packages/api/src/routers/providers.ts` — oRPC providers 路由
- `packages/api/src/services.ts` — 运行时服务类型（注入到 context）

**Modify:**
- `packages/db/src/schema/index.ts` — 导出 providers schema
- `packages/api/src/context.ts` — Context 增加 `services`
- `packages/api/src/routers/index.ts` — 挂载 providers 路由
- `packages/env/src/server.ts` — 增加 `CREDENTIALS_SECRET`、`MODELS_DEV_URL`
- `apps/server/src/index.ts` — 组装 stores/catalog/factory 注入 context

---

## Task 1: 搭建 `packages/agent` 包骨架

**Files:**
- Create: `packages/agent/package.json`, `packages/agent/tsconfig.json`, `packages/agent/vitest.config.ts`
- Create: `packages/agent/src/provider/types.ts`（占位，后续 Task 填充导出）

- [ ] **Step 1: 写 `packages/agent/package.json`**

```json
{
  "name": "@better-agent/agent",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./ports": "./src/ports.ts",
    "./provider/*": "./src/provider/*.ts",
    "./crypto/*": "./src/crypto/*.ts",
    "./testing/*": "./src/testing/*.ts"
  },
  "scripts": {
    "check-types": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "catalog:"
  },
  "devDependencies": {
    "@better-agent/config": "workspace:*",
    "@types/node": "catalog:",
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 2: 写 `packages/agent/tsconfig.json`**

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

- [ ] **Step 3: 写 `packages/agent/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
```

- [ ] **Step 4: 占位类型文件 `packages/agent/src/provider/types.ts`**

```ts
export type Empty = Record<never, never>;
```

- [ ] **Step 5: 安装依赖（AI SDK + vitest，固定版本）**

Run:
```bash
pnpm -F @better-agent/agent add -E ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google @ai-sdk/xai @ai-sdk/openai-compatible
pnpm -F @better-agent/agent add -ED vitest
```
Expected: 安装成功；`packages/agent/package.json` 中这些依赖均为固定版本号（无 `^`）。若 pnpm 拦截 build 脚本，按提示在 `pnpm-workspace.yaml` 的 `allowBuilds` 放行。

- [ ] **Step 6: 校验类型 + 提交**

Run: `pnpm -F @better-agent/agent check-types`
Expected: 通过（无报错）。
```bash
pnpm fix
git add packages/agent pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(agent): scaffold agent runtime package"
```

---

## Task 2: 对称加解密 `secret-box`

**Files:**
- Create: `packages/agent/src/crypto/secret-box.ts`
- Test: `packages/agent/src/crypto/secret-box.test.ts`

- [ ] **Step 1: 写失败测试 `secret-box.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { createSecretBox } from "./secret-box";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("secret-box", () => {
	it("round-trips a plaintext", () => {
		const box = createSecretBox(SECRET);
		const cipher = box.encrypt("sk-test-123");
		expect(cipher).not.toContain("sk-test-123");
		expect(box.decrypt(cipher)).toBe("sk-test-123");
	});

	it("produces different ciphertext each call (random iv)", () => {
		const box = createSecretBox(SECRET);
		expect(box.encrypt("same")).not.toBe(box.encrypt("same"));
	});

	it("rejects tampered ciphertext", () => {
		const box = createSecretBox(SECRET);
		const cipher = box.encrypt("secret");
		const tampered = `${cipher.slice(0, -2)}00`;
		expect(() => box.decrypt(tampered)).toThrow();
	});
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm -F @better-agent/agent test src/crypto/secret-box.test.ts`
Expected: FAIL（`createSecretBox` 未定义）。

- [ ] **Step 3: 实现 `secret-box.ts`**

```ts
import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const SALT = "better-agent.secret-box.v1";

export interface SecretBox {
	encrypt(plaintext: string): string;
	decrypt(payload: string): string;
}

export function createSecretBox(secret: string): SecretBox {
	const key = scryptSync(secret, SALT, KEY_LENGTH);

	return {
		encrypt(plaintext) {
			const iv = randomBytes(IV_LENGTH);
			const cipher = createCipheriv(ALGORITHM, key, iv);
			const encrypted = Buffer.concat([
				cipher.update(plaintext, "utf8"),
				cipher.final(),
			]);
			const tag = cipher.getAuthTag();
			return [
				iv.toString("hex"),
				tag.toString("hex"),
				encrypted.toString("hex"),
			].join(":");
		},

		decrypt(payload) {
			const [ivHex, tagHex, dataHex] = payload.split(":");
			if (!(ivHex && tagHex && dataHex)) {
				throw new Error("Invalid secret-box payload");
			}
			const decipher = createDecipheriv(
				ALGORITHM,
				key,
				Buffer.from(ivHex, "hex")
			);
			decipher.setAuthTag(Buffer.from(tagHex, "hex"));
			return Buffer.concat([
				decipher.update(Buffer.from(dataHex, "hex")),
				decipher.final(),
			]).toString("utf8");
		},
	};
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm -F @better-agent/agent test src/crypto/secret-box.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 提交**

```bash
pnpm fix
git add packages/agent/src/crypto
git commit -m "feat(agent): add aes-256-gcm secret box for credential encryption"
```

---

## Task 3: 领域类型 + 存储接口

**Files:**
- Modify: `packages/agent/src/provider/types.ts`
- Create: `packages/agent/src/ports.ts`

- [ ] **Step 1: 写 `provider/types.ts`（领域类型，无逻辑、无测试）**

```ts
export interface ProviderCatalogEntry {
	providerId: string;
	name: string;
	npm: string | null;
	defaultBaseURL: string | null;
	envKeys: string[];
}

export interface ModelCapabilities {
	toolCall: boolean;
	reasoning: boolean;
	vision: boolean;
}

export interface ModelEntry {
	providerId: string;
	modelId: string;
	name: string;
	contextLimit: number | null;
	maxOutputTokens: number | null;
	inputPricePerM: number | null;
	outputPricePerM: number | null;
	capabilities: ModelCapabilities;
}

export interface ProviderCredential {
	providerId: string;
	apiKey: string;
	baseURL: string | null;
	enabled: boolean;
}
```

- [ ] **Step 2: 写 `ports.ts`（接口，无逻辑、无测试）**

```ts
import type {
	ModelEntry,
	ProviderCatalogEntry,
	ProviderCredential,
} from "./provider/types";

export interface ProviderCatalogStore {
	replaceAll(entries: ProviderCatalogEntry[]): Promise<void>;
	list(): Promise<ProviderCatalogEntry[]>;
	get(providerId: string): Promise<ProviderCatalogEntry | null>;
}

export interface ModelCacheStore {
	replaceAll(entries: ModelEntry[]): Promise<void>;
	listByProvider(providerId: string): Promise<ModelEntry[]>;
	get(providerId: string, modelId: string): Promise<ModelEntry | null>;
}

/** 注意：`get` 返回**已解密**的 apiKey；加解密在仓储实现里完成。 */
export interface ProviderCredentialStore {
	upsert(input: ProviderCredential): Promise<void>;
	delete(providerId: string): Promise<void>;
	/** 列表用，apiKey 字段被脱敏成末四位。 */
	listMasked(): Promise<Array<Omit<ProviderCredential, "apiKey"> & { last4: string }>>;
	get(providerId: string): Promise<ProviderCredential | null>;
}
```

- [ ] **Step 3: 校验类型 + 提交**

Run: `pnpm -F @better-agent/agent check-types`
Expected: 通过。
```bash
pnpm fix
git add packages/agent/src
git commit -m "feat(agent): add provider domain types and store ports"
```

---

## Task 4: 拉取并解析 models.dev

**Files:**
- Create: `packages/agent/src/provider/models-dev.ts`
- Test: `packages/agent/src/provider/models-dev.test.ts`

- [ ] **Step 1: 写失败测试 `models-dev.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseModelsDev } from "./models-dev";

const SAMPLE = {
	anthropic: {
		id: "anthropic",
		name: "Anthropic",
		npm: "@ai-sdk/anthropic",
		api: "https://api.anthropic.com",
		env: ["ANTHROPIC_API_KEY"],
		models: {
			"claude-opus-4-8": {
				id: "claude-opus-4-8",
				name: "Claude Opus 4.8",
				tool_call: true,
				reasoning: true,
				modalities: { input: ["text", "image"], output: ["text"] },
				cost: { input: 15, output: 75 },
				limit: { context: 200_000, output: 64_000 },
			},
		},
	},
};

describe("parseModelsDev", () => {
	it("normalizes providers and models", () => {
		const { providers, models } = parseModelsDev(SAMPLE);
		expect(providers).toEqual([
			{
				providerId: "anthropic",
				name: "Anthropic",
				npm: "@ai-sdk/anthropic",
				defaultBaseURL: "https://api.anthropic.com",
				envKeys: ["ANTHROPIC_API_KEY"],
			},
		]);
		expect(models[0]).toEqual({
			providerId: "anthropic",
			modelId: "claude-opus-4-8",
			name: "Claude Opus 4.8",
			contextLimit: 200_000,
			maxOutputTokens: 64_000,
			inputPricePerM: 15,
			outputPricePerM: 75,
			capabilities: { toolCall: true, reasoning: true, vision: true },
		});
	});

	it("filters to allowed providers when given", () => {
		const { providers } = parseModelsDev(SAMPLE, ["openai"]);
		expect(providers).toEqual([]);
	});
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm -F @better-agent/agent test src/provider/models-dev.test.ts`
Expected: FAIL（`parseModelsDev` 未定义）。

- [ ] **Step 3: 实现 `models-dev.ts`**

```ts
import { z } from "zod";
import type { ModelEntry, ProviderCatalogEntry } from "./types";

const ModelSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	tool_call: z.boolean().optional(),
	reasoning: z.boolean().optional(),
	modalities: z
		.object({ input: z.array(z.string()).optional() })
		.optional(),
	cost: z.object({ input: z.number().optional(), output: z.number().optional() }).optional(),
	limit: z
		.object({ context: z.number().optional(), output: z.number().optional() })
		.optional(),
});

const ProviderSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	npm: z.string().optional(),
	api: z.string().optional(),
	env: z.array(z.string()).optional(),
	models: z.record(z.string(), ModelSchema).default({}),
});

const ApiSchema = z.record(z.string(), ProviderSchema);

const MODELS_DEV_URL = "https://models.dev/api.json";

function toModelEntry(
	providerId: string,
	model: z.infer<typeof ModelSchema>
): ModelEntry {
	return {
		providerId,
		modelId: model.id,
		name: model.name ?? model.id,
		contextLimit: model.limit?.context ?? null,
		maxOutputTokens: model.limit?.output ?? null,
		inputPricePerM: model.cost?.input ?? null,
		outputPricePerM: model.cost?.output ?? null,
		capabilities: {
			toolCall: model.tool_call ?? false,
			reasoning: model.reasoning ?? false,
			vision: model.modalities?.input?.includes("image") ?? false,
		},
	};
}

export function parseModelsDev(
	raw: unknown,
	allowedProviders?: string[]
): { providers: ProviderCatalogEntry[]; models: ModelEntry[] } {
	const parsed = ApiSchema.parse(raw);
	const allow = allowedProviders ? new Set(allowedProviders) : null;
	const providers: ProviderCatalogEntry[] = [];
	const models: ModelEntry[] = [];

	for (const [providerId, provider] of Object.entries(parsed)) {
		if (allow && !allow.has(providerId)) {
			continue;
		}
		providers.push({
			providerId,
			name: provider.name ?? providerId,
			npm: provider.npm ?? null,
			defaultBaseURL: provider.api ?? null,
			envKeys: provider.env ?? [],
		});
		for (const model of Object.values(provider.models)) {
			models.push(toModelEntry(providerId, model));
		}
	}

	return { providers, models };
}

export async function fetchModelsDev(
	url: string = MODELS_DEV_URL
): Promise<unknown> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`models.dev fetch failed: ${response.status}`);
	}
	return response.json();
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm -F @better-agent/agent test src/provider/models-dev.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 提交**

```bash
pnpm fix
git add packages/agent/src/provider
git commit -m "feat(agent): fetch and normalize models.dev catalog"
```

---

## Task 5: 目录同步器 `ModelCatalog`

**Files:**
- Create: `packages/agent/src/testing/fakes.ts`
- Create: `packages/agent/src/provider/model-catalog.ts`
- Test: `packages/agent/src/provider/model-catalog.test.ts`

- [ ] **Step 1: 写内存版存储 `testing/fakes.ts`（测试基础设施）**

```ts
import type {
	ModelCacheStore,
	ProviderCatalogStore,
	ProviderCredentialStore,
} from "../ports";
import type {
	ModelEntry,
	ProviderCatalogEntry,
	ProviderCredential,
} from "../provider/types";

export function createFakeCatalogStore(): ProviderCatalogStore {
	let entries: ProviderCatalogEntry[] = [];
	return {
		replaceAll(next) {
			entries = next;
			return Promise.resolve();
		},
		list() {
			return Promise.resolve(entries);
		},
		get(providerId) {
			return Promise.resolve(
				entries.find((e) => e.providerId === providerId) ?? null
			);
		},
	};
}

export function createFakeModelStore(): ModelCacheStore {
	let entries: ModelEntry[] = [];
	return {
		replaceAll(next) {
			entries = next;
			return Promise.resolve();
		},
		listByProvider(providerId) {
			return Promise.resolve(
				entries.filter((e) => e.providerId === providerId)
			);
		},
		get(providerId, modelId) {
			return Promise.resolve(
				entries.find(
					(e) => e.providerId === providerId && e.modelId === modelId
				) ?? null
			);
		},
	};
}

export function createFakeCredentialStore(
	seed: ProviderCredential[] = []
): ProviderCredentialStore {
	const map = new Map(seed.map((c) => [c.providerId, c]));
	return {
		upsert(input) {
			map.set(input.providerId, input);
			return Promise.resolve();
		},
		delete(providerId) {
			map.delete(providerId);
			return Promise.resolve();
		},
		listMasked() {
			return Promise.resolve(
				[...map.values()].map(({ apiKey, ...rest }) => ({
					...rest,
					last4: apiKey.slice(-4),
				}))
			);
		},
		get(providerId) {
			return Promise.resolve(map.get(providerId) ?? null);
		},
	};
}
```

- [ ] **Step 2: 写失败测试 `model-catalog.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import {
	createFakeCatalogStore,
	createFakeModelStore,
} from "../testing/fakes";
import { createModelCatalog } from "./model-catalog";

const RAW = {
	openai: {
		id: "openai",
		name: "OpenAI",
		npm: "@ai-sdk/openai",
		models: { "gpt-x": { id: "gpt-x", limit: { context: 1000 } } },
	},
};

describe("ModelCatalog.sync", () => {
	it("fetches, parses and stores catalog + models", async () => {
		const catalogStore = createFakeCatalogStore();
		const modelStore = createFakeModelStore();
		const catalog = createModelCatalog({
			catalogStore,
			modelStore,
			fetcher: () => Promise.resolve(RAW),
		});

		await catalog.sync();

		expect((await catalogStore.list())[0].providerId).toBe("openai");
		expect((await modelStore.listByProvider("openai"))[0].modelId).toBe("gpt-x");
	});

	it("keeps old cache when fetch fails", async () => {
		const catalogStore = createFakeCatalogStore();
		await catalogStore.replaceAll([
			{ providerId: "x", name: "X", npm: null, defaultBaseURL: null, envKeys: [] },
		]);
		const catalog = createModelCatalog({
			catalogStore,
			modelStore: createFakeModelStore(),
			fetcher: () => Promise.reject(new Error("network")),
		});

		const result = await catalog.sync();

		expect(result.ok).toBe(false);
		expect((await catalogStore.list())[0].providerId).toBe("x");
	});
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `pnpm -F @better-agent/agent test src/provider/model-catalog.test.ts`
Expected: FAIL（`createModelCatalog` 未定义）。

- [ ] **Step 4: 实现 `model-catalog.ts`**

```ts
import type { ModelCacheStore, ProviderCatalogStore } from "../ports";
import { parseModelsDev } from "./models-dev";

export interface ModelCatalogDeps {
	catalogStore: ProviderCatalogStore;
	modelStore: ModelCacheStore;
	fetcher: () => Promise<unknown>;
	allowedProviders?: string[];
}

export interface SyncResult {
	ok: boolean;
	providerCount: number;
	modelCount: number;
}

export interface ModelCatalog {
	sync(): Promise<SyncResult>;
}

export function createModelCatalog(deps: ModelCatalogDeps): ModelCatalog {
	return {
		async sync() {
			try {
				const raw = await deps.fetcher();
				const { providers, models } = parseModelsDev(
					raw,
					deps.allowedProviders
				);
				await deps.catalogStore.replaceAll(providers);
				await deps.modelStore.replaceAll(models);
				return {
					ok: true,
					providerCount: providers.length,
					modelCount: models.length,
				};
			} catch {
				return { ok: false, providerCount: 0, modelCount: 0 };
			}
		},
	};
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm -F @better-agent/agent test src/provider/model-catalog.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 6: 提交**

```bash
pnpm fix
git add packages/agent/src
git commit -m "feat(agent): add model catalog sync with cache fallback"
```

---

## Task 6: 适配器动态加载 `adapter-loader`

**Files:**
- Create: `packages/agent/src/provider/adapter-loader.ts`
- Test: `packages/agent/src/provider/adapter-loader.test.ts`

> 机制：catalog 的 `npm` 字段决定动态 `import()` 哪个 AI SDK 包；维护一张「npm → 该包的 create 函数名」小映射（仅解析导出名，不是 provider 名单）。未知/未安装的包回退到 `@ai-sdk/openai-compatible` + baseURL。返回值是「`(modelId) => LanguageModel`」工厂。

- [ ] **Step 1: 写失败测试 `adapter-loader.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { loadAdapter } from "./adapter-loader";

describe("loadAdapter", () => {
	it("builds a native anthropic model", async () => {
		const make = await loadAdapter("@ai-sdk/anthropic", {
			apiKey: "sk-test",
			baseURL: null,
		});
		const model = make("claude-opus-4-8");
		expect(model.modelId).toBe("claude-opus-4-8");
	});

	it("falls back to openai-compatible for unknown npm", async () => {
		const make = await loadAdapter("@some/unknown-provider", {
			apiKey: "sk-test",
			baseURL: "https://example.com/v1",
		});
		const model = make("custom-model");
		expect(model.modelId).toBe("custom-model");
	});

	it("throws when fallback has no baseURL", async () => {
		await expect(
			loadAdapter("@some/unknown-provider", { apiKey: "k", baseURL: null })
		).rejects.toThrow(/baseURL/);
	});
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm -F @better-agent/agent test src/provider/adapter-loader.test.ts`
Expected: FAIL（`loadAdapter` 未定义）。

- [ ] **Step 3: 实现 `adapter-loader.ts`**

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";

export interface AdapterCredential {
	apiKey: string;
	baseURL: string | null;
}

export type ModelMaker = (modelId: string) => LanguageModel;

type NativeFactory = (cred: AdapterCredential) => ModelMaker;

function withBaseURL<T extends { apiKey: string; baseURL?: string }>(
	cred: AdapterCredential
): T {
	const options = { apiKey: cred.apiKey } as T;
	if (cred.baseURL) {
		options.baseURL = cred.baseURL;
	}
	return options;
}

const NATIVE_ADAPTERS: Record<string, NativeFactory> = {
	"@ai-sdk/anthropic": (cred) => createAnthropic(withBaseURL(cred)),
	"@ai-sdk/openai": (cred) => createOpenAI(withBaseURL(cred)),
	"@ai-sdk/google": (cred) => createGoogleGenerativeAI(withBaseURL(cred)),
	"@ai-sdk/xai": (cred) => createXai(withBaseURL(cred)),
};

function fallbackMaker(npm: string, cred: AdapterCredential): ModelMaker {
	if (!cred.baseURL) {
		throw new Error(
			`Provider package "${npm}" is not bundled and no baseURL was provided for openai-compatible fallback`
		);
	}
	return createOpenAICompatible({
		name: npm,
		apiKey: cred.apiKey,
		baseURL: cred.baseURL,
	});
}

export function loadAdapter(
	npm: string,
	cred: AdapterCredential
): Promise<ModelMaker> {
	const native = NATIVE_ADAPTERS[npm];
	if (native) {
		return Promise.resolve(native(cred));
	}
	return Promise.resolve(fallbackMaker(npm, cred));
}
```

> 说明：本期把 5 个常用适配器静态 import（供打包/类型）。`loadAdapter` 保持 async 签名，便于后续阶段改为真正的 `await import(npm)` 处理未预装包，调用方无需改动。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm -F @better-agent/agent test src/provider/adapter-loader.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 提交**

```bash
pnpm fix
git add packages/agent/src/provider
git commit -m "feat(agent): add ai-sdk adapter loader with openai-compatible fallback"
```

---

## Task 7: 模型工厂 `model-factory`

**Files:**
- Create: `packages/agent/src/provider/model-factory.ts`
- Test: `packages/agent/src/provider/model-factory.test.ts`

- [ ] **Step 1: 写失败测试 `model-factory.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
	createFakeCatalogStore,
	createFakeCredentialStore,
} from "../testing/fakes";
import { createModelFactory } from "./model-factory";

async function setup() {
	const catalogStore = createFakeCatalogStore();
	await catalogStore.replaceAll([
		{
			providerId: "anthropic",
			name: "Anthropic",
			npm: "@ai-sdk/anthropic",
			defaultBaseURL: "https://api.anthropic.com",
			envKeys: [],
		},
	]);
	const credentialStore = createFakeCredentialStore([
		{ providerId: "anthropic", apiKey: "sk-test", baseURL: null, enabled: true },
	]);
	return createModelFactory({ catalogStore, credentialStore });
}

describe("createModelFactory", () => {
	it("builds a language model from catalog + credential", async () => {
		const factory = await setup();
		const model = await factory.create("anthropic", "claude-opus-4-8");
		expect(model.modelId).toBe("claude-opus-4-8");
	});

	it("throws when provider has no credential", async () => {
		const catalogStore = createFakeCatalogStore();
		await catalogStore.replaceAll([
			{ providerId: "openai", name: "OpenAI", npm: "@ai-sdk/openai", defaultBaseURL: null, envKeys: [] },
		]);
		const factory = createModelFactory({
			catalogStore,
			credentialStore: createFakeCredentialStore(),
		});
		await expect(factory.create("openai", "gpt-x")).rejects.toThrow(/credential/);
	});
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm -F @better-agent/agent test src/provider/model-factory.test.ts`
Expected: FAIL（`createModelFactory` 未定义）。

- [ ] **Step 3: 实现 `model-factory.ts`**

```ts
import type { LanguageModel } from "ai";
import type { ProviderCatalogStore, ProviderCredentialStore } from "../ports";
import { loadAdapter } from "./adapter-loader";

export interface ModelFactoryDeps {
	catalogStore: ProviderCatalogStore;
	credentialStore: ProviderCredentialStore;
}

export interface ModelFactory {
	create(providerId: string, modelId: string): Promise<LanguageModel>;
}

export function createModelFactory(deps: ModelFactoryDeps): ModelFactory {
	return {
		async create(providerId, modelId) {
			const provider = await deps.catalogStore.get(providerId);
			if (!provider) {
				throw new Error(`Unknown provider: ${providerId}`);
			}
			const credential = await deps.credentialStore.get(providerId);
			if (!(credential && credential.enabled)) {
				throw new Error(`No enabled credential for provider: ${providerId}`);
			}
			if (!provider.npm) {
				throw new Error(`Provider ${providerId} has no npm adapter`);
			}
			const make = await loadAdapter(provider.npm, {
				apiKey: credential.apiKey,
				baseURL: credential.baseURL ?? provider.defaultBaseURL,
			});
			return make(modelId);
		},
	};
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm -F @better-agent/agent test src/provider/model-factory.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 全包测试 + 提交**

Run: `pnpm -F @better-agent/agent test`
Expected: 全部 PASS。
```bash
pnpm fix
git add packages/agent/src/provider
git commit -m "feat(agent): add model factory resolving catalog + credential"
```

---

## Task 8: Drizzle schema（三张表）

**Files:**
- Create: `packages/db/src/schema/providers.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: 确认 db 包依赖 agent 包（取 port 类型）**

Run:
```bash
pnpm -F @better-agent/db add @better-agent/agent@workspace:*
```
Expected: `packages/db/package.json` 增加 `"@better-agent/agent": "workspace:*"`。

- [ ] **Step 2: 写 `packages/db/src/schema/providers.ts`**

```ts
import {
	boolean,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import type { ModelCapabilities } from "@better-agent/agent/provider/types";

export const providersCatalog = pgTable("providers_catalog", {
	providerId: text("provider_id").primaryKey(),
	name: text("name").notNull(),
	npm: text("npm"),
	defaultBaseURL: text("default_base_url"),
	envKeys: jsonb("env_keys").$type<string[]>().notNull().default([]),
	lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const modelsCache = pgTable(
	"models_cache",
	{
		providerId: text("provider_id").notNull(),
		modelId: text("model_id").notNull(),
		name: text("name").notNull(),
		contextLimit: integer("context_limit"),
		maxOutputTokens: integer("max_output_tokens"),
		inputPricePerM: real("input_price_per_m"),
		outputPricePerM: real("output_price_per_m"),
		capabilities: jsonb("capabilities").$type<ModelCapabilities>().notNull(),
		lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.providerId, table.modelId] })]
);

export const providerCredentials = pgTable("provider_credentials", {
	providerId: text("provider_id").primaryKey(),
	apiKeyCipher: text("api_key_cipher").notNull(),
	baseURL: text("base_url"),
	enabled: boolean("enabled").notNull().default(true),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
```

- [ ] **Step 3: 修改 `packages/db/src/schema/index.ts`**

把现有的 `export {};` 整体替换为：
```ts
export * from "./providers";
```

- [ ] **Step 4: 生成并应用 schema（需本地 postgres 在跑）**

Run:
```bash
pnpm db:start
pnpm -F @better-agent/db db:push
```
Expected: drizzle 把三张表推到数据库，无错误。

- [ ] **Step 5: 校验类型 + 提交**

Run: `pnpm -F @better-agent/db check-types`
Expected: 通过。
```bash
pnpm fix
git add packages/db
git commit -m "feat(db): add provider catalog, models cache, credentials schema"
```

---

## Task 9: Drizzle 仓储实现（实现 ports）

**Files:**
- Create: `packages/db/src/repositories/provider-stores.ts`
- Test: `packages/db/src/repositories/provider-stores.integration.test.ts`

> 这些是 ports 的薄适配层，靠一个集成测试验证（需 `DATABASE_URL` + 已 push 的表）。凭证仓储用注入的 `SecretBox` 加解密 apiKey。

- [ ] **Step 1: 给 db 包加 vitest**

Run: `pnpm -F @better-agent/db add -ED vitest`
Then 写 `packages/db/vitest.config.ts`：
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```
并在 `packages/db/package.json` 的 `scripts` 增加 `"test": "vitest run"`。

- [ ] **Step 2: 写集成测试 `provider-stores.integration.test.ts`**

```ts
import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../schema";
import {
	createProviderCatalogStore,
	createProviderCredentialStore,
} from "./provider-stores";

const url = process.env.DATABASE_URL;
const db = drizzle(url ?? "", { schema });
const box = createSecretBox("0123456789abcdef0123456789abcdef");

describe.skipIf(!url)("provider stores (integration)", () => {
	beforeEach(async () => {
		await db.delete(schema.providersCatalog);
		await db.delete(schema.providerCredentials);
	});
	afterAll(async () => {
		await db.delete(schema.providersCatalog);
		await db.delete(schema.providerCredentials);
	});

	it("catalog replaceAll + get", async () => {
		const store = createProviderCatalogStore(db);
		await store.replaceAll([
			{ providerId: "openai", name: "OpenAI", npm: "@ai-sdk/openai", defaultBaseURL: null, envKeys: ["OPENAI_API_KEY"] },
		]);
		expect((await store.get("openai"))?.name).toBe("OpenAI");
	});

	it("credential upsert stores ciphertext, get decrypts, listMasked hides key", async () => {
		const store = createProviderCredentialStore(db, box);
		await store.upsert({ providerId: "openai", apiKey: "sk-secret-1234", baseURL: null, enabled: true });
		expect((await store.get("openai"))?.apiKey).toBe("sk-secret-1234");
		const masked = await store.listMasked();
		expect(masked[0].last4).toBe("1234");
		expect(JSON.stringify(masked)).not.toContain("sk-secret-1234");
	});
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `DATABASE_URL=$DATABASE_URL pnpm -F @better-agent/db test`
Expected: FAIL（仓储函数未定义）。若无 `DATABASE_URL`，用例会 skip——务必设置后再跑。

- [ ] **Step 4: 实现 `provider-stores.ts`**

```ts
import type {
	ModelCacheStore,
	ProviderCatalogStore,
	ProviderCredentialStore,
} from "@better-agent/agent/ports";
import type { SecretBox } from "@better-agent/agent/crypto/secret-box";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";

type Db = NodePgDatabase<typeof schema>;

export function createProviderCatalogStore(db: Db): ProviderCatalogStore {
	return {
		async replaceAll(entries) {
			await db.transaction(async (tx) => {
				await tx.delete(schema.providersCatalog);
				if (entries.length > 0) {
					await tx.insert(schema.providersCatalog).values(entries);
				}
			});
		},
		list() {
			return db.select().from(schema.providersCatalog);
		},
		async get(providerId) {
			const rows = await db
				.select()
				.from(schema.providersCatalog)
				.where(eq(schema.providersCatalog.providerId, providerId))
				.limit(1);
			return rows[0] ?? null;
		},
	};
}

export function createModelCacheStore(db: Db): ModelCacheStore {
	return {
		async replaceAll(entries) {
			await db.transaction(async (tx) => {
				await tx.delete(schema.modelsCache);
				if (entries.length > 0) {
					await tx.insert(schema.modelsCache).values(entries);
				}
			});
		},
		listByProvider(providerId) {
			return db
				.select()
				.from(schema.modelsCache)
				.where(eq(schema.modelsCache.providerId, providerId));
		},
		async get(providerId, modelId) {
			const rows = await db
				.select()
				.from(schema.modelsCache)
				.where(
					and(
						eq(schema.modelsCache.providerId, providerId),
						eq(schema.modelsCache.modelId, modelId)
					)
				)
				.limit(1);
			return rows[0] ?? null;
		},
	};
}

export function createProviderCredentialStore(
	db: Db,
	box: SecretBox
): ProviderCredentialStore {
	return {
		async upsert(input) {
			const values = {
				providerId: input.providerId,
				apiKeyCipher: box.encrypt(input.apiKey),
				baseURL: input.baseURL,
				enabled: input.enabled,
				updatedAt: new Date(),
			};
			await db
				.insert(schema.providerCredentials)
				.values(values)
				.onConflictDoUpdate({
					target: schema.providerCredentials.providerId,
					set: {
						apiKeyCipher: values.apiKeyCipher,
						baseURL: values.baseURL,
						enabled: values.enabled,
						updatedAt: values.updatedAt,
					},
				});
		},
		async delete(providerId) {
			await db
				.delete(schema.providerCredentials)
				.where(eq(schema.providerCredentials.providerId, providerId));
		},
		async listMasked() {
			const rows = await db.select().from(schema.providerCredentials);
			return rows.map((row) => ({
				providerId: row.providerId,
				baseURL: row.baseURL,
				enabled: row.enabled,
				last4: box.decrypt(row.apiKeyCipher).slice(-4),
			}));
		},
		async get(providerId) {
			const rows = await db
				.select()
				.from(schema.providerCredentials)
				.where(eq(schema.providerCredentials.providerId, providerId))
				.limit(1);
			const row = rows[0];
			if (!row) {
				return null;
			}
			return {
				providerId: row.providerId,
				apiKey: box.decrypt(row.apiKeyCipher),
				baseURL: row.baseURL,
				enabled: row.enabled,
			};
		},
	};
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `DATABASE_URL=$DATABASE_URL pnpm -F @better-agent/db test`
Expected: PASS（2 个集成用例）。

- [ ] **Step 6: 提交**

```bash
pnpm fix
git add packages/db
git commit -m "feat(db): implement provider/model/credential drizzle stores"
```

---

## Task 10: oRPC `providers` 路由 + 服务注入

**Files:**
- Create: `packages/api/src/services.ts`
- Create: `packages/api/src/routers/providers.ts`
- Modify: `packages/api/src/context.ts`, `packages/api/src/routers/index.ts`

- [ ] **Step 1: 定义注入服务类型 `packages/api/src/services.ts`**

```ts
import type { ModelCatalog } from "@better-agent/agent/provider/model-catalog";
import type { ModelFactory } from "@better-agent/agent/provider/model-factory";
import type {
	ModelCacheStore,
	ProviderCatalogStore,
	ProviderCredentialStore,
} from "@better-agent/agent/ports";

export interface AgentServices {
	catalog: ModelCatalog;
	modelFactory: ModelFactory;
	stores: {
		providerCatalog: ProviderCatalogStore;
		modelCache: ModelCacheStore;
		providerCredential: ProviderCredentialStore;
	};
}
```

- [ ] **Step 2: 在 `packages/api/src/context.ts` 增加 `services`**

把文件改为：
```ts
import type { Context as HonoContext } from "hono";
import type { AgentServices } from "./services";

export interface CreateContextOptions {
	context: HonoContext;
	services: AgentServices;
}

// biome-ignore lint/suspicious/useAwait: context 工厂按约定为异步，便于后续接入 session/auth 查询
export async function createContext(options: CreateContextOptions) {
	return {
		services: options.services,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
```

- [ ] **Step 3: 添加 db 包依赖 agent（api 也要 agent 类型）**

Run: `pnpm -F @better-agent/api add @better-agent/agent@workspace:*`
Expected: api package.json 增加该依赖。

- [ ] **Step 4: 写 `packages/api/src/routers/providers.ts`**

```ts
import { z } from "zod";
import { publicProcedure } from "../index";

const upsertInput = z.object({
	providerId: z.string().min(1),
	apiKey: z.string().min(1),
	baseURL: z.url().nullable().default(null),
	enabled: z.boolean().default(true),
});

export const providersRouter = {
	catalogList: publicProcedure.handler(({ context }) =>
		context.services.stores.providerCatalog.list()
	),

	catalogRefresh: publicProcedure.handler(({ context }) =>
		context.services.catalog.sync()
	),

	credentialsList: publicProcedure.handler(({ context }) =>
		context.services.stores.providerCredential.listMasked()
	),

	credentialsUpsert: publicProcedure
		.input(upsertInput)
		.handler(async ({ input, context }) => {
			await context.services.stores.providerCredential.upsert(input);
			return { ok: true };
		}),

	credentialsDelete: publicProcedure
		.input(z.object({ providerId: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			await context.services.stores.providerCredential.delete(input.providerId);
			return { ok: true };
		}),

	modelsList: publicProcedure
		.input(z.object({ providerId: z.string().min(1) }))
		.handler(({ input, context }) =>
			context.services.stores.modelCache.listByProvider(input.providerId)
		),
};
```

- [ ] **Step 5: 挂载到 `packages/api/src/routers/index.ts`**

```ts
import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { providersRouter } from "./providers";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => "OK"),
	providers: providersRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
```

- [ ] **Step 6: 校验类型 + 提交**

Run: `pnpm -F @better-agent/api check-types`
Expected: 通过。
```bash
pnpm fix
git add packages/api
git commit -m "feat(api): add providers router and inject agent services into context"
```

---

## Task 11: 组装到 `apps/server` + 端到端验证

**Files:**
- Modify: `packages/env/src/server.ts`, `apps/server/src/index.ts`
- Add dep: `@better-agent/agent`、`@better-agent/db` 到 `apps/server`

- [ ] **Step 1: env 增加 `CREDENTIALS_SECRET` 与 `MODELS_DEV_URL`**

在 `packages/env/src/server.ts` 的 `server: {...}` 内追加：
```ts
		CREDENTIALS_SECRET: z.string().min(32),
		MODELS_DEV_URL: z.url().default("https://models.dev/api.json"),
```

- [ ] **Step 2: 确保 `.env` 有值**

在 `apps/server/.env`（及根 `.env`，按现有约定）加：
```
CREDENTIALS_SECRET=please-change-me-to-a-32+char-secret-string
```

- [ ] **Step 3: server 依赖运行时与 db**

Run:
```bash
pnpm -F server add @better-agent/agent@workspace:* @better-agent/db@workspace:*
```

- [ ] **Step 4: 在 `apps/server/src/index.ts` 组装服务并注入 context**

在 import 区加入：
```ts
import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import { createModelCatalog } from "@better-agent/agent/provider/model-catalog";
import { createModelFactory } from "@better-agent/agent/provider/model-factory";
import { fetchModelsDev } from "@better-agent/agent/provider/models-dev";
import { db } from "@better-agent/db";
import {
	createModelCacheStore,
	createProviderCatalogStore,
	createProviderCredentialStore,
} from "@better-agent/db/repositories/provider-stores";
```

> 注意：`@better-agent/db` 需在其 `package.json` 的 `exports` 暴露 `"./repositories/*": "./src/repositories/*.ts"` 与默认入口 `".": "./src/index.ts"`。若尚未配置，在本步补上。

在 `createContext(...)` 调用前构造服务：
```ts
const secretBox = createSecretBox(env.CREDENTIALS_SECRET);
const providerCatalog = createProviderCatalogStore(db);
const modelCache = createModelCacheStore(db);
const providerCredential = createProviderCredentialStore(db, secretBox);
const services = {
	catalog: createModelCatalog({
		catalogStore: providerCatalog,
		modelStore: modelCache,
		fetcher: () => fetchModelsDev(env.MODELS_DEV_URL),
	}),
	modelFactory: createModelFactory({
		catalogStore: providerCatalog,
		credentialStore: providerCredential,
	}),
	stores: { providerCatalog, modelCache, providerCredential },
};
```

把现有的 `createContext({ context: c })` 改为 `createContext({ context: c, services })`。

- [ ] **Step 5: 校验类型**

Run: `pnpm check-types`
Expected: 全仓库通过。

- [ ] **Step 6: 端到端手动验证**

Run（先确保 postgres 在跑、schema 已 push）：
```bash
pnpm db:start
pnpm -F server dev
```
另开终端，刷新目录并查询（端口按 server 实际监听，默认 3000）：
```bash
curl -s -X POST localhost:3000/rpc/providers/catalogRefresh | head
curl -s -X POST localhost:3000/rpc/providers/catalogList | head
```
Expected: `catalogRefresh` 返回 `{ ok: true, providerCount: >0, modelCount: >0 }`；`catalogList` 返回 provider 数组（含 anthropic/openai 等）。

> 路径形式 `/rpc/<router>/<procedure>` 取决于 oRPC RPCHandler 的实际约定；若不确定，用 web 端 oRPC client 调 `orpc.providers.catalogRefresh()` 验证更稳妥。

- [ ] **Step 7: 凭证写入与脱敏验证（可选但推荐）**

用 oRPC client 或 curl 调 `providers.credentialsUpsert` 写入一个真实 key，再 `credentialsList` 确认只返回末四位、不含明文；最后在 web/脚本里 `services.modelFactory.create(providerId, modelId)` 能拿到模型对象。

- [ ] **Step 8: 提交**

```bash
pnpm fix
git add apps/server packages/env packages/db
git commit -m "feat(server): assemble provider registry services and env secret"
```

---

## Self-Review（计划作者自检结论）

- **Spec 覆盖**：本计划覆盖 spec 第 2 节（packages/agent + ports + 注入）、第 3 节全部（providers_catalog/models_cache/provider_credentials、ModelCatalog 同步、动态适配器 + openai-compatible 回退、模型工厂、密钥加密、provider→model 选择所需的 `modelsList`）、第 11 节 `providers` 路由。Session/Agent/SDK/Web 属后续计划，符合分层拆分。
- **占位扫描**：无 TBD/“稍后实现”；每个改动步骤含完整代码或精确命令。
- **类型一致性**：`ProviderCatalogEntry/ModelEntry/ProviderCredential/ModelCapabilities`（Task 3）在 Task 4/5/8/9 一致使用；`ProviderCatalogStore/ModelCacheStore/ProviderCredentialStore`（Task 3）在 fakes（Task 5）、drizzle 实现（Task 9）、路由（Task 10）签名一致；`createModelCatalog/createModelFactory/loadAdapter/createSecretBox` 命名前后一致。
- **已知风险**：① `loadAdapter` 本期用静态 import 5 个适配器（保留 async 签名以便日后改真·动态 import）；② Drizzle 仓储靠集成测试（需 `DATABASE_URL`），无库时自动 skip；③ oRPC RPC 调用路径在 Task 11 标注了以 client 验证为准。
