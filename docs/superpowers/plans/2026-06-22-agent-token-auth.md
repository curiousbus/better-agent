# Agent Token Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every agent auto-mints a single hashed, show-once token; the oRPC chat-plane endpoints become token-gated and scoped to the token's agent, and the Agent SDK + admin carry the token instead of `agentId`.

**Architecture:** A pure `TokenService` (random token + sha256) lives in `packages/agent`. `agents.token_hash` stores only the hash. `createContext` resolves an `authedAgent` from the `Authorization: Bearer` header; a new `agentProcedure` gates `sessions.*` and scopes every session op to that agent. The SDK sends the token as a header; admin shows/caches the one-time plaintext and dogfoods chat through the SDK.

**Tech Stack:** TypeScript, Drizzle (Postgres / PGlite), oRPC, Hono, node:crypto, Vitest, TanStack (admin).

**Spec:** [`docs/superpowers/specs/2026-06-22-agent-token-design.md`](../specs/2026-06-22-agent-token-design.md)

## Global Constraints

- Ultracite/Biome standards: kebab-case filenames; no `any` (use `unknown`); prefer `interface` over `type` for object shapes; `for...of` over `.forEach`; run `pnpm dlx ultracite fix` before each commit. Pre-commit hook runs format+lint+eslint and will block non-compliant commits.
- Token format: `ba_` prefix + 32 random bytes base64url. Stored as `sha256(token)` hex (64 chars). Plaintext never persisted — returned once from `create`/`rotateToken`.
- Auth header: `Authorization: Bearer <token>`.
- Chat-plane gated procedures: `sessions.create / get / listMessages / run / prompt`. Public management plane (unchanged this round): `sessions.list`, `agents.*`, `providers.*`, `healthCheck`.
- Cross-agent session access returns `NOT_FOUND` (never reveal another agent's sessions).
- Tests inject context directly via `createRouterClient(appRouter, { context })`; header parsing is tested separately against `createContext`.
- Commit message footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: TokenService (pure)

**Files:**
- Create: `packages/agent/src/crypto/agent-token.ts`
- Test: `packages/agent/src/crypto/agent-token.test.ts`

**Interfaces:**
- Consumes: nothing (leaf).
- Produces:
  - `interface TokenService { generate(): { token: string; hash: string }; hash(token: string): string; }`
  - `createTokenService(): TokenService`
  - Imported elsewhere as `@better-agent/agent/crypto/agent-token`.

- [ ] **Step 1: Write the failing test**

`packages/agent/src/crypto/agent-token.test.ts`:
```ts
import { expect, it } from "vitest";
import { createTokenService } from "./agent-token";

it("generate returns a ba_-prefixed token whose hash is its sha256", () => {
	const svc = createTokenService();
	const { token, hash } = svc.generate();
	expect(token.startsWith("ba_")).toBe(true);
	expect(hash).toBe(svc.hash(token));
	expect(hash).toHaveLength(64);
});

it("generate returns unique tokens", () => {
	const svc = createTokenService();
	expect(svc.generate().token).not.toBe(svc.generate().token);
});

it("hash is deterministic for the same token", () => {
	const svc = createTokenService();
	expect(svc.hash("ba_abc")).toBe(svc.hash("ba_abc"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @better-agent/agent exec vitest run src/crypto/agent-token.test.ts`
Expected: FAIL — cannot find module `./agent-token`.

- [ ] **Step 3: Write minimal implementation**

`packages/agent/src/crypto/agent-token.ts`:
```ts
import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "ba_";
const TOKEN_BYTES = 32;

export interface TokenService {
	generate(): { token: string; hash: string };
	hash(token: string): string;
}

export function createTokenService(): TokenService {
	const hash = (token: string): string =>
		createHash("sha256").update(token).digest("hex");
	return {
		hash,
		generate() {
			const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
			return { token, hash: hash(token) };
		},
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @better-agent/agent exec vitest run src/crypto/agent-token.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
pnpm dlx ultracite fix packages/agent/src/crypto/agent-token.ts packages/agent/src/crypto/agent-token.test.ts
git add packages/agent/src/crypto/agent-token.ts packages/agent/src/crypto/agent-token.test.ts
git commit -m "feat(agent): add TokenService for agent tokens"
```

---

### Task 2: Token-aware AgentStore (schema + port + fake + drizzle)

**Files:**
- Modify: `packages/agent/src/ports.ts` (AgentStore interface)
- Modify: `packages/agent/src/testing/fakes.ts` (createFakeAgentStore)
- Modify: `packages/db/src/schema/agents.ts` (add column)
- Create: `packages/db/src/migrations/0003_*.sql` (via drizzle-kit generate, then hand-edit)
- Modify: `packages/db/src/repositories/agent-store.ts`
- Test: `packages/db/src/repositories/agent-store.integration.test.ts` (extend)

**Interfaces:**
- Consumes: `AgentConfig`, `AgentInput` from `@better-agent/agent/agent/types` (unchanged).
- Produces — `AgentStore` (in `ports.ts`) becomes:
  - `create(input: AgentInput & { tokenHash: string }): Promise<AgentConfig>`
  - `rotateToken(id: string, tokenHash: string): Promise<AgentConfig | null>`
  - `findByTokenHash(tokenHash: string): Promise<AgentConfig | null>`
  - (`get`/`list`/`update`/`delete` unchanged)
  - `AgentConfig` still has **no** token field.

- [ ] **Step 1: Update the AgentStore port interface**

In `packages/agent/src/ports.ts`, replace the `AgentStore` interface:
```ts
export interface AgentStore {
	create(input: AgentInput & { tokenHash: string }): Promise<AgentConfig>;
	delete(id: string): Promise<void>;
	findByTokenHash(tokenHash: string): Promise<AgentConfig | null>;
	get(id: string): Promise<AgentConfig | null>;
	list(): Promise<AgentConfig[]>;
	rotateToken(id: string, tokenHash: string): Promise<AgentConfig | null>;
	update(id: string, input: AgentInput): Promise<AgentConfig | null>;
}
```

- [ ] **Step 2: Update the fake store to match**

In `packages/agent/src/testing/fakes.ts`, inside `createFakeAgentStore`, change `create` to accept `tokenHash` and add the two new methods. The fake stores `tokenHash` in a side map (since `AgentConfig` has no token field):
```ts
export function createFakeAgentStore(seed: AgentConfig[] = []): AgentStore {
	const map = new Map(seed.map((agent) => [agent.id, agent]));
	const hashes = new Map<string, string>(); // agentId -> tokenHash
	return {
		create(input: AgentInput & { tokenHash: string }) {
			const now = new Date();
			const { tokenHash, ...rest } = input;
			const agent: AgentConfig = {
				id: crypto.randomUUID(),
				...rest,
				createdAt: now,
				updatedAt: now,
			};
			map.set(agent.id, agent);
			hashes.set(agent.id, tokenHash);
			return Promise.resolve(agent);
		},
		findByTokenHash(tokenHash) {
			for (const [id, hash] of hashes) {
				if (hash === tokenHash) {
					return Promise.resolve(map.get(id) ?? null);
				}
			}
			return Promise.resolve(null);
		},
		rotateToken(id, tokenHash) {
			const existing = map.get(id);
			if (!existing) {
				return Promise.resolve(null);
			}
			hashes.set(id, tokenHash);
			const updated: AgentConfig = { ...existing, updatedAt: new Date() };
			map.set(id, updated);
			return Promise.resolve(updated);
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
			const updated: AgentConfig = {
				...existing,
				...input,
				updatedAt: new Date(),
			};
			map.set(id, updated);
			return Promise.resolve(updated);
		},
		delete(id) {
			map.delete(id);
			hashes.delete(id);
			return Promise.resolve();
		},
	};
}
```

- [ ] **Step 3: Add the schema column**

In `packages/db/src/schema/agents.ts`, add inside `pgTable("agents", { ... })` after `modelId`:
```ts
	tokenHash: text("token_hash").notNull().unique(),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm -F @better-agent/db db:generate`
Expected: a new file `packages/db/src/migrations/0003_*.sql` and an updated snapshot under `migrations/meta/`.

- [ ] **Step 5: Hand-edit the migration to be backfill-safe**

Replace the body of the generated `0003_*.sql` so it works on tables that already have rows (add nullable → backfill unique placeholder hashes → enforce not-null + unique). Keep the same filename and the `migrations/meta` snapshot drizzle generated:
```sql
ALTER TABLE "agents" ADD COLUMN "token_hash" text;--> statement-breakpoint
UPDATE "agents" SET "token_hash" = md5("id"::text || random()::text) WHERE "token_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_token_hash_unique" ON "agents" USING btree ("token_hash");
```
(Backfilled rows have no known plaintext → those agents must rotate once to get a usable token. There is no production data yet.)

- [ ] **Step 6: Update the drizzle store implementation**

In `packages/db/src/repositories/agent-store.ts`:
- `create` already spreads `input` into the insert; since `input` now includes `tokenHash`, it maps to the `token_hash` column automatically — no change needed there beyond the type flowing through.
- Add `findByTokenHash` and `rotateToken`. Replace the returned object so it includes them:
```ts
	return {
		async create(input) {
			const rows = await db.insert(schema.agents).values(input).returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create agent");
			}
			return toAgentConfig(row);
		},
		async findByTokenHash(tokenHash) {
			const rows = await db
				.select()
				.from(schema.agents)
				.where(eq(schema.agents.tokenHash, tokenHash))
				.limit(1);
			const row = rows[0];
			return row ? toAgentConfig(row) : null;
		},
		async rotateToken(id, tokenHash) {
			const rows = await db
				.update(schema.agents)
				.set({ tokenHash, updatedAt: new Date() })
				.where(eq(schema.agents.id, id))
				.returning();
			const row = rows[0];
			return row ? toAgentConfig(row) : null;
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
```
(`toAgentConfig` is unchanged — it does not read `token_hash`, so the hash never leaks into `AgentConfig`.)

- [ ] **Step 7: Update existing integration tests + add token tests**

In `packages/db/src/repositories/agent-store.integration.test.ts`, the shared `INPUT` must now carry a `tokenHash`. Change it and add three tests:
```ts
const INPUT = {
	name: "Helper",
	description: "A helpful agent",
	systemPrompt: "You are helpful.",
	providerId: "anthropic",
	modelId: "claude-opus-4-5",
	params: null,
	tokenHash: "hash-1",
};

it("findByTokenHash returns the agent for a known hash and null otherwise", async () => {
	const store = createAgentStore(db);
	const created = await store.create(INPUT);
	expect((await store.findByTokenHash("hash-1"))?.id).toBe(created.id);
	expect(await store.findByTokenHash("nope")).toBeNull();
});

it("rotateToken swaps the hash so the old one stops resolving", async () => {
	const store = createAgentStore(db);
	const created = await store.create(INPUT);
	await store.rotateToken(created.id, "hash-2");
	expect(await store.findByTokenHash("hash-1")).toBeNull();
	expect((await store.findByTokenHash("hash-2"))?.id).toBe(created.id);
});

it("create rejects a duplicate token hash", async () => {
	const store = createAgentStore(db);
	await store.create(INPUT);
	await expect(
		store.create({ ...INPUT, name: "Other", tokenHash: "hash-1" })
	).rejects.toThrow();
});
```
For any other `store.create({...})` calls in this file (e.g. the `list` test's `{ ...INPUT, name: "Second" }`), give them a distinct `tokenHash` (e.g. `tokenHash: "hash-2"`) to avoid the unique collision.

- [ ] **Step 8: Run the db + agent test suites**

Run: `pnpm -F @better-agent/db test && pnpm -F @better-agent/agent test`
Expected: PASS. (Migration applies cleanly on the fresh PGlite db; fake matches the new interface.)

- [ ] **Step 9: Typecheck the two packages**

Run: `pnpm -F @better-agent/agent check-types && pnpm -F @better-agent/db check-types`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
pnpm dlx ultracite fix packages/agent/src packages/db/src
git add packages/agent/src/ports.ts packages/agent/src/testing/fakes.ts packages/db/src/schema/agents.ts packages/db/src/repositories/agent-store.ts packages/db/src/repositories/agent-store.integration.test.ts packages/db/src/migrations
git commit -m "feat(db): store hashed agent token; add findByTokenHash + rotateToken"
```

---

### Task 3: API context auth + agentProcedure + services wiring

**Files:**
- Modify: `packages/api/src/services.ts` (add `tokenService`)
- Modify: `packages/api/src/context.ts` (resolve `authedAgent`)
- Modify: `packages/api/src/index.ts` (export `agentProcedure`)
- Modify: `apps/server/src/index.ts` (instantiate `tokenService` in `buildServices`)
- Test: `packages/api/src/context.test.ts` (new)

**Interfaces:**
- Consumes: `TokenService`/`createTokenService` (Task 1); `AgentStore.findByTokenHash` (Task 2); `AgentConfig`.
- Produces:
  - `AgentServices` gains `tokenService: TokenService`.
  - `Context` becomes `{ services: AgentServices; authedAgent: AgentConfig | null }`.
  - `agentProcedure` exported from `packages/api/src/index.ts`; handlers downstream get non-null `context.authedAgent: AgentConfig`.

- [ ] **Step 1: Add tokenService to AgentServices**

In `packages/api/src/services.ts`, add the import and field:
```ts
import type { TokenService } from "@better-agent/agent/crypto/agent-token";
```
and inside `AgentServices` (top of the interface):
```ts
	tokenService: TokenService;
```

- [ ] **Step 2: Write the failing context test**

`packages/api/src/context.test.ts`:
```ts
import { createTokenService } from "@better-agent/agent/crypto/agent-token";
import { createFakeAgentStore } from "@better-agent/agent/testing/fakes";
import { expect, it } from "vitest";
import { createContext } from "./context";
import type { AgentServices } from "./services";

function fakeHono(authHeader?: string) {
	return {
		req: { header: (name: string) => (name.toLowerCase() === "authorization" ? authHeader : undefined) },
	} as never;
}

async function setup() {
	const tokenService = createTokenService();
	const agentStore = createFakeAgentStore();
	const { token } = tokenService.generate();
	const agent = await agentStore.create({
		name: "A",
		description: "d",
		systemPrompt: "s",
		providerId: "openai",
		modelId: "gpt-x",
		params: null,
		tokenHash: tokenService.hash(token),
	});
	const services = { tokenService, stores: { agent } } as unknown as AgentServices;
	return { services, token, agentId: agent.id };
}

it("resolves authedAgent from a valid Bearer token", async () => {
	const { services, token, agentId } = await setup();
	const ctx = await createContext({ context: fakeHono(`Bearer ${token}`), services });
	expect(ctx.authedAgent?.id).toBe(agentId);
});

it("authedAgent is null with no header", async () => {
	const { services } = await setup();
	const ctx = await createContext({ context: fakeHono(undefined), services });
	expect(ctx.authedAgent).toBeNull();
});

it("authedAgent is null for an unknown token", async () => {
	const { services } = await setup();
	const ctx = await createContext({ context: fakeHono("Bearer ba_nope"), services });
	expect(ctx.authedAgent).toBeNull();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -F @better-agent/api exec vitest run src/context.test.ts`
Expected: FAIL — `createContext` returns no `authedAgent`.

- [ ] **Step 4: Implement context resolution**

Replace `packages/api/src/context.ts`:
```ts
import type { AgentConfig } from "@better-agent/agent/agent/types";
import type { Context as HonoContext } from "hono";
import type { AgentServices } from "./services";

export interface CreateContextOptions {
	context: HonoContext;
	services: AgentServices;
}

const BEARER_PREFIX = "Bearer ";

async function resolveAuthedAgent(
	options: CreateContextOptions
): Promise<AgentConfig | null> {
	const header = options.context.req.header("authorization");
	if (!header?.startsWith(BEARER_PREFIX)) {
		return null;
	}
	const token = header.slice(BEARER_PREFIX.length).trim();
	if (!token) {
		return null;
	}
	const hash = options.services.tokenService.hash(token);
	return await options.services.stores.agent.findByTokenHash(hash);
}

export async function createContext(options: CreateContextOptions) {
	return {
		services: options.services,
		authedAgent: await resolveAuthedAgent(options),
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
```

- [ ] **Step 5: Run the context test to verify it passes**

Run: `pnpm -F @better-agent/api exec vitest run src/context.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Add agentProcedure**

Replace `packages/api/src/index.ts`:
```ts
import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

export const agentProcedure = o.use(({ context, next }) => {
	const agent = context.authedAgent;
	if (!agent) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Missing or invalid agent token",
		});
	}
	return next({ context: { authedAgent: agent } });
});
```

- [ ] **Step 7: Wire tokenService into the server**

In `apps/server/src/index.ts`, add the import:
```ts
import { createTokenService } from "@better-agent/agent/crypto/agent-token";
```
Inside `buildServices`, create it and include it in the returned object (add `tokenService` next to `runtime`/`modelFactory`):
```ts
	const tokenService = createTokenService();
```
and in the returned object literal add:
```ts
		tokenService,
```

- [ ] **Step 8: Typecheck api + server**

Run: `pnpm -F @better-agent/api check-types && pnpm -F server check-types`
Expected: no errors. (Note: `packages/api` tests in `sessions.test.ts` will still typecheck because they cast `services as never`, but they will be updated in Task 5.)

- [ ] **Step 9: Commit**

```bash
pnpm dlx ultracite fix packages/api/src apps/server/src
git add packages/api/src/services.ts packages/api/src/context.ts packages/api/src/context.test.ts packages/api/src/index.ts apps/server/src/index.ts
git commit -m "feat(api): resolve authedAgent from bearer token; add agentProcedure"
```

---

### Task 4: agents router — mint token on create + rotateToken

**Files:**
- Modify: `packages/api/src/routers/agents.ts`
- Test: `packages/api/src/routers/agents.test.ts` (new)

**Interfaces:**
- Consumes: `context.services.tokenService` (Task 3); `AgentStore.create`/`rotateToken` (Task 2).
- Produces:
  - `agents.create` now returns `{ agent: AgentConfig; token: string }` (was `AgentConfig`).
  - `agents.rotateToken` (new): input `{ id: string }` → `{ agent: AgentConfig; token: string }`.
  - `agents.list/get/update/delete` unchanged.

- [ ] **Step 1: Write the failing test**

`packages/api/src/routers/agents.test.ts`:
```ts
import { createTokenService } from "@better-agent/agent/crypto/agent-token";
import { createFakeAgentStore } from "@better-agent/agent/testing/fakes";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

function buildClient() {
	const tokenService = createTokenService();
	const agentStore = createFakeAgentStore();
	const services = {
		tokenService,
		agentValidator: { validate: () => Promise.resolve(null) },
		stores: { agent: agentStore },
	};
	const client = createRouterClient(appRouter, {
		context: { services: services as never, authedAgent: null },
	});
	return { client, tokenService, agentStore };
}

const INPUT = {
	name: "Helper",
	description: "d",
	systemPrompt: "s",
	providerId: "openai",
	modelId: "gpt-x",
	params: null,
};

it("create returns the agent plus a one-time ba_ token", async () => {
	const { client, tokenService, agentStore } = buildClient();
	const result = await client.agents.create(INPUT);
	expect(result.token.startsWith("ba_")).toBe(true);
	expect(result.agent.name).toBe("Helper");
	// the stored hash resolves back to the created agent
	const found = await agentStore.findByTokenHash(tokenService.hash(result.token));
	expect(found?.id).toBe(result.agent.id);
});

it("rotateToken issues a new token and invalidates the old one", async () => {
	const { client, tokenService, agentStore } = buildClient();
	const created = await client.agents.create(INPUT);
	const rotated = await client.agents.rotateToken({ id: created.agent.id });
	expect(rotated.token).not.toBe(created.token);
	expect(await agentStore.findByTokenHash(tokenService.hash(created.token))).toBeNull();
	expect(
		(await agentStore.findByTokenHash(tokenService.hash(rotated.token)))?.id
	).toBe(created.agent.id);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @better-agent/api exec vitest run src/routers/agents.test.ts`
Expected: FAIL — `result.token` undefined / `rotateToken` not a function.

- [ ] **Step 3: Implement create + rotateToken**

In `packages/api/src/routers/agents.ts`, change the `create` handler and add `rotateToken`. Replace the `create` entry and append `rotateToken`:
```ts
	create: publicProcedure
		.input(agentInput)
		.handler(async ({ input, context }) => {
			await assertValidAgent(context.services.agentValidator, {
				providerId: input.providerId,
				modelId: input.modelId,
			});
			const { token, hash } = context.services.tokenService.generate();
			const agent = await context.services.stores.agent.create({
				...input,
				tokenHash: hash,
			});
			return { agent, token };
		}),

	rotateToken: publicProcedure
		.input(idInput)
		.handler(async ({ input, context }) => {
			const { token, hash } = context.services.tokenService.generate();
			const agent = await context.services.stores.agent.rotateToken(
				input.id,
				hash
			);
			if (!agent) {
				throw new ORPCError("NOT_FOUND", {
					message: `Agent ${input.id} not found`,
				});
			}
			return { agent, token };
		}),
```
(`idInput`, `agentInput`, `assertValidAgent`, and the `ORPCError` import already exist in this file.)

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -F @better-agent/api exec vitest run src/routers/agents.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
pnpm dlx ultracite fix packages/api/src/routers/agents.ts packages/api/src/routers/agents.test.ts
git add packages/api/src/routers/agents.ts packages/api/src/routers/agents.test.ts
git commit -m "feat(api): mint agent token on create; add agents.rotateToken"
```

---

### Task 5: sessions router — gate + scope to authedAgent

**Files:**
- Modify: `packages/api/src/routers/sessions.ts`
- Test: `packages/api/src/routers/sessions.test.ts` (update existing)

**Interfaces:**
- Consumes: `agentProcedure` (Task 3); `context.authedAgent` (Task 3).
- Produces:
  - `sessions.create` input is now `{}` (no `agentId`); derives agent from `context.authedAgent.id`.
  - `sessions.get / listMessages / run / prompt` require a token and only operate on sessions whose `agentId === authedAgent.id`.
  - `sessions.list` unchanged (public, all sessions).

- [ ] **Step 1: Update the test harness + assertions**

In `packages/api/src/routers/sessions.test.ts`:

Change `buildClient` so the created agent carries a `tokenHash`, the context includes `authedAgent`, and `sessions.create` takes no `agentId`. Replace the agent creation + client construction:
```ts
	const agent = await agentStore.create({
		name: "Helper",
		description: "d",
		systemPrompt: "You are helpful.",
		providerId: "openai",
		modelId: "gpt-x",
		params: null,
		tokenHash: "hash-1",
	});
	const runtime = createSessionRuntime({
		sessionStore,
		messageStore,
		agentStore,
		modelFactory: { create: () => Promise.resolve(mockModel(HAPPY)) },
	});
	const services = {
		runtime,
		stores: { agent: agentStore, session: sessionStore, message: messageStore },
	};
	const client = createRouterClient(appRouter, {
		context: { services: services as never, authedAgent: agent },
	});
	return { client, agentStore, agent, services };
```

Replace the "create rejects an unknown agent" test (agentId is gone) with a scoping + auth pair, and update every `sessions.create({ agentId })` call to `sessions.create({})`. Note the anon + other-agent clients reuse the **same `services`** (so `requireOwnedSession` actually runs and returns NOT_FOUND rather than crashing on a missing store):
```ts
it("create derives the agent from the token and binds the session to it", async () => {
	const { client, agent } = await buildClient();
	const session = await client.sessions.create({});
	expect(session.agentId).toBe(agent.id);
});

it("rejects chat-plane calls without a token", async () => {
	const { services } = await buildClient();
	const anon = createRouterClient(appRouter, {
		context: { services: services as never, authedAgent: null },
	});
	await expect(anon.sessions.create({})).rejects.toThrow();
});

it("cannot read another agent's session (NOT_FOUND, not a crash)", async () => {
	const { client, agentStore, services } = await buildClient();
	const session = await client.sessions.create({});
	const otherAgent = await agentStore.create({
		name: "Other",
		description: "d",
		systemPrompt: "s",
		providerId: "openai",
		modelId: "gpt-x",
		params: null,
		tokenHash: "hash-2",
	});
	const otherClient = createRouterClient(appRouter, {
		context: { services: services as never, authedAgent: otherAgent },
	});
	await expect(
		otherClient.sessions.listMessages({ sessionId: session.id })
	).rejects.toThrow();
});
```
Update the remaining `run`/`prompt` tests: replace `client.sessions.create({ agentId })` with `client.sessions.create({})` and drop the now-unused `agentId` from their destructuring.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @better-agent/api exec vitest run src/routers/sessions.test.ts`
Expected: FAIL — `create` still wants `agentId`; no scoping.

- [ ] **Step 3: Implement gating + scoping**

Replace `packages/api/src/routers/sessions.ts`. Key changes: `agentProcedure` import; a `requireOwnedSession` helper; `create` input `{}`; gated procedures use `context.authedAgent`:
```ts
import type { RunEvent } from "@better-agent/agent/session/events";
import type { Message } from "@better-agent/agent/session/types";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { agentProcedure, publicProcedure } from "../index";

const idInput = z.object({ id: z.uuid() });
const sessionIdInput = z.object({ sessionId: z.uuid() });
const promptInput = z.object({
	sessionId: z.uuid(),
	text: z.string().min(1),
});

// Loads the session and asserts it belongs to the authed agent. Returns
// NOT_FOUND for both missing and other-agent sessions so existence never leaks.
async function requireOwnedSession(
	context: Context,
	agentId: string,
	sessionId: string
): Promise<void> {
	const session = await context.services.stores.session.get(sessionId);
	if (!session || session.agentId !== agentId) {
		throw new ORPCError("NOT_FOUND", {
			message: `Session ${sessionId} not found`,
		});
	}
}

async function drain(gen: AsyncGenerator<RunEvent, Message>): Promise<Message> {
	let next = await gen.next();
	while (!next.done) {
		next = await gen.next();
	}
	return next.value;
}

function errorMessage(error: unknown): string {
	if (error instanceof ORPCError) {
		return error.message;
	}
	return error instanceof Error ? error.message : String(error);
}

async function* streamTurn(
	context: Context,
	agentId: string,
	input: { sessionId: string; text: string },
	signal: AbortSignal | undefined
): AsyncGenerator<RunEvent, void> {
	try {
		await requireOwnedSession(context, agentId, input.sessionId);
		yield* context.services.runtime.runTurn({
			sessionId: input.sessionId,
			text: input.text,
			abortSignal: signal,
		});
	} catch (error) {
		yield { type: "error", message: errorMessage(error) };
	}
}

export const sessionsRouter = {
	create: agentProcedure.handler(({ context }) =>
		context.services.stores.session.create({
			agentId: context.authedAgent.id,
		})
	),

	get: agentProcedure.input(idInput).handler(async ({ input, context }) => {
		await requireOwnedSession(context, context.authedAgent.id, input.id);
		return context.services.stores.session.get(input.id);
	}),

	list: publicProcedure.handler(({ context }) =>
		context.services.stores.session.list()
	),

	listMessages: agentProcedure
		.input(sessionIdInput)
		.handler(async ({ input, context }) => {
			await requireOwnedSession(
				context,
				context.authedAgent.id,
				input.sessionId
			);
			return context.services.stores.message.listWithParts(input.sessionId);
		}),

	run: agentProcedure
		.input(promptInput)
		.handler(async ({ input, context, signal }) => {
			await requireOwnedSession(
				context,
				context.authedAgent.id,
				input.sessionId
			);
			return drain(
				context.services.runtime.runTurn({
					sessionId: input.sessionId,
					text: input.text,
					abortSignal: signal,
				})
			);
		}),

	prompt: agentProcedure
		.input(promptInput)
		.handler(({ input, context, signal }) =>
			streamTurn(context, context.authedAgent.id, input, signal)
		),
};
```
(The old `createInput`/`requireSession` are removed; `create` no longer validates the agent exists because the token already proves it.)

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -F @better-agent/api exec vitest run src/routers/sessions.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole api + agent suites and typecheck**

Run: `pnpm -F @better-agent/api test && pnpm -F @better-agent/api check-types`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
pnpm dlx ultracite fix packages/api/src/routers/sessions.ts packages/api/src/routers/sessions.test.ts
git add packages/api/src/routers/sessions.ts packages/api/src/routers/sessions.test.ts
git commit -m "feat(api): gate sessions on agent token and scope to the agent"
```

---

### Task 6: Agent SDK — token instead of agentId

**Files:**
- Modify: `packages/client/src/index.ts`
- Test: `packages/client/src/index.test.ts` (update)

**Interfaces:**
- Consumes: the new `sessions.create({})` shape (Task 5).
- Produces:
  - `interface AgentClientConfig { baseURL: string; token: string }` (was `{ agentId; baseURL }`).
  - `createAgentClient(config: AgentClientConfig): AgentClient`.
  - `createAgentClientFrom(client: Client): AgentClient` (drops the `agentId` arg).
  - `AgentClient` methods (`createSession/listMessages/run/stream`) unchanged.

- [ ] **Step 1: Read the existing test to mirror its injection style**

Run: `sed -n '1,80p' packages/client/src/index.test.ts`
Note how it builds a stub `Client` and calls `createAgentClientFrom`. The update removes the `agentId` argument and the stub's `sessions.create` now takes `{}`.

- [ ] **Step 2: Update the test (failing)**

In `packages/client/src/index.test.ts`, change every `createAgentClientFrom(stub, "<agentId>")` to `createAgentClientFrom(stub)`, and change the stub's `sessions.create` to accept an empty object and return a session (no `agentId` assertion). For example the create stub becomes:
```ts
		sessions: {
			create: (_input: Record<string, never>) =>
				Promise.resolve({ id: "session-1", agentId: "agent-1" }),
			// ...run / prompt / listMessages stubs unchanged
		},
```
If a test asserted `create` was called with a specific `agentId`, replace that assertion with one that it was called with `{}`.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -F @better-agent/client test`
Expected: FAIL — `createAgentClientFrom` still expects two args / config type mismatch.

- [ ] **Step 4: Implement the token-based SDK**

In `packages/client/src/index.ts`:

Replace `AgentClientConfig`:
```ts
export interface AgentClientConfig {
	/** server 根地址，如 "http://localhost:3000"；SDK 自动拼 "/rpc"。 */
	baseURL: string;
	/** agent token（创建 agent 时一次性返回）。SDK 以 Bearer 头携带。 */
	token: string;
}
```

Replace `createAgentClientFrom` to drop `agentId` and call `create({})`:
```ts
export function createAgentClientFrom(client: Client): AgentClient {
	const ensureSession = async (sessionId?: string): Promise<string> =>
		sessionId ?? (await client.sessions.create({})).id;
	return {
		async createSession() {
			const session = await client.sessions.create({});
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
```

Replace `createAgentClient` to send the bearer header and drop `agentId`:
```ts
export function createAgentClient(config: AgentClientConfig): AgentClient {
	const link = new RPCLink({
		url: `${config.baseURL}/rpc`,
		headers: { authorization: `Bearer ${config.token}` },
	});
	const client = createORPCClient(link) as Client;
	return createAgentClientFrom(client);
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm -F @better-agent/client test && pnpm -F @better-agent/client check-types`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
pnpm dlx ultracite fix packages/client/src
git add packages/client/src/index.ts packages/client/src/index.test.ts
git commit -m "feat(client): carry agent token instead of agentId"
```

---

### Task 7: admin — surface token on create + cache it

**Files:**
- Create: `apps/admin/src/utils/agent-token.ts` (localStorage helpers)
- Modify: `apps/admin/src/components/agents/agent-wizard.tsx` (and/or `agents-card.tsx`) — consume the new `{ agent, token }` create result, cache + show token.
- Modify: any caller that reads `orpc.agents.create` result as a bare agent.

**Interfaces:**
- Consumes: `agents.create` → `{ agent, token }` (Task 4); `agents.rotateToken` (Task 4).
- Produces:
  - `saveAgentToken(agentId: string, token: string): void`
  - `loadAgentToken(agentId: string): string | null`
  - `clearAgentToken(agentId: string): void`

- [ ] **Step 1: Add the token cache helper**

`apps/admin/src/utils/agent-token.ts`:
```ts
const KEY_PREFIX = "agentToken:";

export function saveAgentToken(agentId: string, token: string): void {
	localStorage.setItem(`${KEY_PREFIX}${agentId}`, token);
}

export function loadAgentToken(agentId: string): string | null {
	return localStorage.getItem(`${KEY_PREFIX}${agentId}`);
}

export function clearAgentToken(agentId: string): void {
	localStorage.removeItem(`${KEY_PREFIX}${agentId}`);
}
```

- [ ] **Step 2: Locate the create-result consumers**

Run: `grep -rn "agents.create\|agents\.update\|createAgent" apps/admin/src`
For each place that uses the create mutation's result as an agent (e.g. reading `.id`/`.name`), it must now read `result.agent`. Note the exact files/lines before editing.

- [ ] **Step 3: Update the create flow to cache + show the token**

In the agent create success handler (the `onSuccess` of `orpc.agents.create.mutationOptions`, in `agent-wizard.tsx`), the mutation result is `{ agent, token }`. After a successful create:
```ts
import { saveAgentToken } from "@/utils/agent-token";
// ...
onSuccess: (result) => {
	saveAgentToken(result.agent.id, result.token);
	queryClient.invalidateQueries({ queryKey: orpc.agents.list.key() });
	// surface the one-time token to the user (copyable):
	toast.success("Agent created. Token (shown once):", {
		description: result.token,
		duration: 30_000,
	});
	// ...existing close/navigate logic, using result.agent where the agent was used
},
```
Adjust any code that previously used the raw agent object to use `result.agent`. (If a dedicated "token shown once" dialog is preferred over a toast, render a small dialog with a copy button using the existing `Dialog` + `Button` components; the toast is the minimal acceptable surface.)

- [ ] **Step 4: Typecheck admin**

Run: `pnpm -F admin check-types`
Expected: no errors. (This is the gate that catches every stale `create` result consumer.)

- [ ] **Step 5: Manual verification**

Run: `pnpm -F admin dev` then create an agent in the UI. Expected: a toast shows the `ba_…` token; `localStorage` has `agentToken:<id>`; the agents list refreshes. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
pnpm dlx ultracite fix apps/admin/src
git add apps/admin/src/utils/agent-token.ts apps/admin/src/components/agents
git commit -m "feat(admin): show + cache one-time agent token on create"
```

---

### Task 8: admin — chat through the SDK + regenerate token

**Files:**
- Create: `apps/admin/src/utils/agent-client.ts` (build SDK from cached token)
- Modify: `apps/admin/src/components/sessions/use-chat.ts` (use SDK for create/listMessages/stream)
- Modify: `apps/admin/src/routes/agents.$agentId.tsx` (regenerate-token action + pass token down)

**Interfaces:**
- Consumes: `createAgentClient` (Task 6); `loadAgentToken`/`saveAgentToken` (Task 7); `agents.rotateToken` (Task 4).
- Produces:
  - `getAgentClient(agentId: string): AgentClient | null` — builds the SDK from the cached token (null if none cached).

- [ ] **Step 1: Add the SDK factory helper**

`apps/admin/src/utils/agent-client.ts`:
```ts
import { createAgentClient } from "@better-agent/client";
import type { AgentClient } from "@better-agent/client";
import { env } from "@better-agent/env/web";
import { loadAgentToken } from "@/utils/agent-token";

export function getAgentClient(agentId: string): AgentClient | null {
	const token = loadAgentToken(agentId);
	if (!token) {
		return null;
	}
	return createAgentClient({ baseURL: env.VITE_SERVER_URL, token });
}
```
(Confirm the export name for `AgentClient` from `@better-agent/client`; it is exported from `packages/client/src/index.ts`.)

- [ ] **Step 2: Route chat through the SDK**

In `apps/admin/src/components/sessions/use-chat.ts`, the hook currently uses `client.sessions.prompt` and `orpc.sessions.listMessages`. Thread an `AgentClient` (from `getAgentClient(agentId)`) into the hook and use it:
- replace `client.sessions.prompt({ sessionId, text })` with `agentClient.stream(text, { sessionId })`;
- replace the `orpc.sessions.listMessages` query's fetch with `agentClient.listMessages(sessionId)` (keep TanStack Query for caching, but the `queryFn` calls the SDK);
- session creation (`orpc.sessions.create`) becomes `agentClient.createSession()`.

The hook should accept `agentClient: AgentClient` as an argument (the page provides it). Keep `orpc.sessions.list` (the session picker) as-is — that's the public management list.

- [ ] **Step 3: Add the regenerate-token action on the agent page**

In `apps/admin/src/routes/agents.$agentId.tsx`:
- compute `const agentClient = getAgentClient(agentId)`;
- if it is `null`, render a "Generate token" button instead of the chat; on click call the rotate mutation:
```ts
import { saveAgentToken } from "@/utils/agent-token";
// ...
const rotate = useMutation(
	orpc.agents.rotateToken.mutationOptions({
		onSuccess: (result) => {
			saveAgentToken(result.agent.id, result.token);
			// re-render so getAgentClient now returns a client
		},
	})
);
```
- also offer a "Regenerate token" control (popover-confirm, per admin-ui-conventions) that calls the same mutation and re-caches — warn that it invalidates external clients on the old token.
- pass the non-null `agentClient` into the chat component / `use-chat`.

- [ ] **Step 4: Typecheck admin**

Run: `pnpm -F admin check-types`
Expected: no errors.

- [ ] **Step 5: Manual verification (end-to-end)**

Start the DB + server + admin (`pnpm db:start`, `pnpm -F server dev`, `pnpm -F admin dev`). In admin:
1. Create an agent (provider credentials must exist) → token toast + cached.
2. Open the agent → chat renders (client built from cached token).
3. Send a message → streamed assistant reply (proves the SDK's bearer token authes the chat plane end-to-end).
4. Clear `localStorage` for that agent → page shows "Generate token" → click → chat returns.
Stop all dev processes; delete any test agent/session rows created (per clean-up-test-data).

- [ ] **Step 6: Commit**

```bash
pnpm dlx ultracite fix apps/admin/src
git add apps/admin/src/utils/agent-client.ts apps/admin/src/components/sessions/use-chat.ts apps/admin/src/routes/agents.\$agentId.tsx
git commit -m "feat(admin): chat via Agent SDK with cached token + regenerate"
```

---

## Final verification

- [ ] **Full typecheck:** `pnpm check-types` — all packages clean.
- [ ] **Full test suite:** `pnpm -r test` (or `turbo test`) — green.
- [ ] **Lint:** `pnpm dlx ultracite check packages apps` — clean.
- [ ] **Spec coverage confirmed:** token model (§3) → Task 2; TokenService/store (§4) → Tasks 1–2; oRPC auth (§5) → Tasks 3,5; SDK (§6) → Task 6; admin UX (§7) → Tasks 7–8; non-goals (§1) respected (management plane untouched).
