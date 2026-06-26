# Admin Service Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Configure `COMPOSIO_API_KEY` (and future companion secrets) from an admin page, stored encrypted, applied at runtime with no restart. Design: `docs/superpowers/specs/2026-06-25-admin-settings-design.md`.

**Architecture:** A `settings` table (encrypted values via the existing `SecretBox`) + a `SettingsStore`; the composio service becomes a runtime **resolver** (`() => Promise<ComposioService | null>`) reading the DB key ?? env; an admin `settings` router (list/set/clear over an allowlist, never returns secrets) + an admin Settings page.

**Tech Stack:** Drizzle, oRPC, `SecretBox` (AES-256-GCM, `CREDENTIALS_SECRET`), TanStack Router/Query.

## Global Constraints

- Migrations via `pnpm db:generate` then `pnpm db:migrate` (shared local DB — NEVER `db:push`). Commit the migration.
- Secrets ENCRYPTED at rest (mirror `provider_credentials.api_key_cipher` + `createSecretBox`); the API never returns a stored secret (only `configured`/`source`); settings router is `adminProcedure`-gated; writable keys are an `z.enum` allowlist.
- No `any` (`as never`/`as unknown` in tests only); `??` over `||` (genuine boolean OR may use `||`); functions ≤50; files ≤300; conventional-commits + footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit BARE (no grep/head pipe). `pnpm exec biome lint <files>` from repo ROOT.

---

### Task 1: `settings` table + `SettingsStore`

**Files:**
- Create: `packages/db/src/schema/settings.ts` (+ generate/apply migration) + export it from the schema barrel (`packages/db/src/schema/index.ts` if present, else wherever `agents`/`providers` are re-exported)
- Modify: `packages/agent/src/ports.ts` (`SettingsStore`)
- Create: `packages/db/src/repositories/settings-store.ts`
- Modify: `packages/agent/src/testing/` — add a `createFakeSettingsStore` (in-memory) next to the other fakes
- Modify: `packages/api/src/services.ts` (`stores.settings: SettingsStore`)
- Modify: `apps/server/src/index.ts` (`buildServices` → `settings: createSettingsStore(db, secretBox)` in `stores`)
- Test: `packages/db/src/repositories/settings-store.integration.test.ts` (mirror `session-store.integration.test.ts` PGlite harness)

**Interfaces:**
- Produces:
```ts
export interface SettingsStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
}
```

- [ ] **Step 1: schema + migration**

`packages/db/src/schema/settings.ts`:
```ts
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const settings = pgTable("settings", {
	key: text("key").primaryKey(),
	valueCipher: text("value_cipher").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
```
Re-export it wherever the other tables are exported (check `packages/db/src/schema/*` barrel). `pnpm db:generate` then `pnpm db:migrate`. Commit the migration.

- [ ] **Step 2: port** — add `SettingsStore` (above) to `packages/agent/src/ports.ts`.

- [ ] **Step 3: DB impl** — `packages/db/src/repositories/settings-store.ts` (mirror the provider-credential store's `createSecretBox` usage; `import * as schema` + `eq`):
```ts
export function createSettingsStore(db: Db, box: SecretBox): SettingsStore {
	return {
		async get(key) {
			const rows = await db.select().from(schema.settings)
				.where(eq(schema.settings.key, key)).limit(1);
			const row = rows[0];
			return row ? box.decrypt(row.valueCipher) : null;
		},
		async set(key, value) {
			const valueCipher = box.encrypt(value);
			await db.insert(schema.settings)
				.values({ key, valueCipher, updatedAt: new Date() })
				.onConflictDoUpdate({
					target: schema.settings.key,
					set: { valueCipher, updatedAt: new Date() },
				});
		},
		async delete(key) {
			await db.delete(schema.settings).where(eq(schema.settings.key, key));
		},
	};
}
```
(Driver-agnostic `Db` type like the other stores; import `SecretBox` type.)

- [ ] **Step 4: fake** — `createFakeSettingsStore(): SettingsStore` backed by a `Map<string,string>` (no encryption), in the testing fakes module.

- [ ] **Step 5: wire** — `services.ts`: `stores.settings: SettingsStore`. `apps/server/src/index.ts` `buildServices`: the `secretBox` already exists (`createSecretBox(env.CREDENTIALS_SECRET)`); add `settings: createSettingsStore(db, secretBox)` to the `stores` object.

- [ ] **Step 6: integration test** — mirror `session-store.integration.test.ts`: `set("K","v")` then `get("K") === "v"`; `get("missing") === null`; after `delete("K")`, `get("K") === null`; assert the raw `value_cipher` column is NOT the plaintext.

- [ ] **Step 7: verify + commit**
```bash
pnpm check-types
pnpm -F @better-agent/db test
pnpm exec biome lint <changed files>
git add packages/db packages/agent/src/ports.ts packages/agent/src/testing packages/api/src/services.ts apps/server/src/index.ts
git commit -m "$(printf 'feat(db): encrypted settings store\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Dynamic composio resolver

**Files:**
- Modify: `packages/api/src/services.ts` (`composio: () => Promise<ComposioService | null>`)
- Modify: `apps/server/src/optional-services.ts` (replace `buildComposio` with `buildComposioResolver(settings)`)
- Modify: `apps/server/src/index.ts` (`composio: buildComposioResolver(settings)`)
- Create: `apps/server/src/composio-resolver.test.ts`
- Modify: `packages/api/src/routers/composio.ts` (5 sites: `await context.services.composio()`)
- Modify: `packages/api/src/routers/user-sessions.ts` (resolve before `safeComposioDefs`)
- Modify: `packages/api/src/routers/composio.test.ts`, `packages/api/src/routers/user-sessions.test.ts` (fixtures → resolver)

**Interfaces:**
- Consumes: `SettingsStore` (Task 1).
- Changes: `AgentServices.composio` is now `() => Promise<ComposioService | null>`.

- [ ] **Step 1: services type** — `services.ts`: change `composio: ComposioService | null;` → `composio: () => Promise<ComposioService | null>;`.

- [ ] **Step 2: resolver + failing test**

`apps/server/src/optional-services.ts` — replace `buildComposio` with:
```ts
import type { ComposioService } from "@better-agent/agent/tool/composio-tools";
import type { SettingsStore } from "@better-agent/agent/ports";

export function buildComposioResolver(settings: SettingsStore) {
	let cache: { key: string; service: ComposioService } | null = null;
	return async (): Promise<ComposioService | null> => {
		const key = (await settings.get("COMPOSIO_API_KEY")) ?? env.COMPOSIO_API_KEY ?? null;
		if (!key) { cache = null; return null; }
		if (cache?.key !== key) {
			cache = { key, service: createComposioService({ apiKey: key, toolkits: env.COMPOSIO_TOOLKITS }) };
		}
		return cache.service;
	};
}
```
`apps/server/src/composio-resolver.test.ts` — with a fake `SettingsStore` (Map-backed): no db key + (clear `env.COMPOSIO_API_KEY` via the fake's empty + the test can't set env easily, so) — test the resolver THROUGH the settings path: a settings store returning null → resolver returns `null` only if env also unset. Since env may be set in the test process, test the DETERMINISTIC parts: (a) a settings store returning a key → resolver returns a non-null service; (b) calling twice with the SAME key returns the SAME instance (identity ===); (c) changing the settings key returns a DIFFERENT instance. (Do not assert the null case unless you can guarantee `env.COMPOSIO_API_KEY` is unset — instead inject env via a small param if needed, or skip the null assertion and cover it in the router test with a null resolver.)

- [ ] **Step 3: wire** — `apps/server/src/index.ts`: `composio: buildComposioResolver(settings)` where `settings` is the store built in Task 1 (`const settings = createSettingsStore(db, secretBox)` — hoist it to a local in `buildServices` so both `stores.settings` and the resolver use the same instance).

- [ ] **Step 4: migrate call sites**

`packages/api/src/routers/composio.ts` — in EACH of the 5 handlers, change `const svc = context.services.composio;` → `const svc = await context.services.composio();`.
`packages/api/src/routers/user-sessions.ts` `streamUserTurn` — change the composio line to:
```ts
const composioSvc = await context.services.composio();
const composioDefs = await safeComposioDefs(composioSvc, userId, agent?.composioToolkits ?? []);
```
(`safeComposioDefs` signature unchanged — it still takes `ComposioService | null`.)

- [ ] **Step 5: fix fixtures**

`composio.test.ts` + `user-sessions.test.ts`: every `composio: <X>` in a services object becomes `composio: () => Promise.resolve(<X>)`. Where a helper takes a `composio: ComposioService | null` param and puts it in services, wrap it: `composio: () => Promise.resolve(composio)`.

- [ ] **Step 6: verify + commit**
```bash
pnpm check-types
pnpm -F server test composio-resolver
pnpm -F @better-agent/api test
pnpm -F server build
pnpm exec biome lint <changed files>
git add packages/api/src/services.ts apps/server/src/optional-services.ts apps/server/src/index.ts apps/server/src/composio-resolver.test.ts packages/api/src/routers/composio.ts packages/api/src/routers/composio.test.ts packages/api/src/routers/user-sessions.ts packages/api/src/routers/user-sessions.test.ts
git commit -m "$(printf 'feat(server): resolve composio from settings at runtime\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Settings admin router

**Files:**
- Create: `packages/api/src/routers/settings.ts` + `packages/api/src/routers/settings.test.ts`
- Modify: `packages/api/src/routers/index.ts` (register `settings`)
- Modify: `packages/api/src/services.ts` (`envSecretKeys: string[]`)
- Modify: `apps/server/src/index.ts` (`envSecretKeys` from env)

- [ ] **Step 1: services field** — `services.ts`: add `envSecretKeys: string[];`. `apps/server/src/index.ts` `buildServices`: `envSecretKeys: env.COMPOSIO_API_KEY ? ["COMPOSIO_API_KEY"] : []` (extend as more secrets become dynamic).

- [ ] **Step 2: router**

`packages/api/src/routers/settings.ts`:
```ts
import { z } from "zod";
import { adminProcedure } from "../index";

const SECRET_SETTINGS = [
	{ key: "COMPOSIO_API_KEY", label: "Composio API Key", help: "用于 composio 工具与连接,设置后立即生效。" },
] as const;
const KEYS = SECRET_SETTINGS.map((s) => s.key) as [string, ...string[]];

export const settingsRouter = {
	list: adminProcedure.handler(async ({ context }) => {
		const out = [];
		for (const s of SECRET_SETTINGS) {
			const dbVal = await context.services.stores.settings.get(s.key);
			const inEnv = context.services.envSecretKeys.includes(s.key);
			const source = dbVal ? "db" : inEnv ? "env" : "none";
			out.push({ key: s.key, label: s.label, help: s.help, configured: source !== "none", source });
		}
		return out;
	}),
	set: adminProcedure
		.input(z.object({ key: z.enum(KEYS), value: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			await context.services.stores.settings.set(input.key, input.value);
			return { ok: true };
		}),
	clear: adminProcedure
		.input(z.object({ key: z.enum(KEYS) }))
		.handler(async ({ input, context }) => {
			await context.services.stores.settings.delete(input.key);
			return { ok: true };
		}),
};
```
Register `settings: settingsRouter` in `routers/index.ts`.

- [ ] **Step 3: tests** — `settings.test.ts` (admin caller harness, mirror `composio.test.ts`'s admin client; fake settings store + `envSecretKeys`):
- `list`: with nothing set + `envSecretKeys: []` → composio `source: "none", configured: false`; with `envSecretKeys: ["COMPOSIO_API_KEY"]` → `source: "env"`; after `set` → `source: "db"`. NEVER includes the value.
- `set` stores (then `list` reflects db); `clear` deletes (then env/none).
- non-admin caller → FORBIDDEN on `list`/`set`/`clear`.

- [ ] **Step 4: verify + commit**
```bash
pnpm check-types
pnpm -F @better-agent/api test
pnpm exec biome lint <changed files>
git add packages/api/src/routers/settings.ts packages/api/src/routers/settings.test.ts packages/api/src/routers/index.ts packages/api/src/services.ts apps/server/src/index.ts
git commit -m "$(printf 'feat(api): admin settings router for service secrets\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Admin Settings page

**Files:**
- Create: `apps/admin/src/routes/settings.tsx`
- Modify: `apps/admin/src/components/sidebar.tsx`

- [ ] **Step 1: page** — `createFileRoute("/settings")`; `useQuery(orpc.settings.list.queryOptions())`; derive the row type from the router client. For each setting render a flat row (mirror `users.tsx` style, no cards): `label` + `help` (muted) + a status `Badge` ("Set in admin" when `source==="db"`, "Using env" when `"env"`, "Not set" when `"none"`) + a `type="password"` `Input` (local state per row) + **Save** button (`useMutation(orpc.settings.set...)` `.mutate({ key, value })`, `onSuccess` → invalidate `orpc.settings.list.key()` + clear the input + toast "Saved", `onError` → toast) + a **Clear** button shown only when `source==="db"` (`orpc.settings.clear` → invalidate). Extract a `SettingRow` component; keep functions ≤50 lines.
- [ ] **Step 2: sidebar** — import `SlidersHorizontal` from `lucide-react`; add `{ kind: "item", item: { to: "/settings", label: "Settings", icon: SlidersHorizontal } }` to `SECTIONS`.
- [ ] **Step 3: verify + commit**
```bash
pnpm -F admin build
cd apps/admin && pnpm exec tsc --noEmit && cd ../..
pnpm exec biome lint apps/admin/src/routes/settings.tsx apps/admin/src/components/sidebar.tsx
git add apps/admin/src/routes/settings.tsx apps/admin/src/components/sidebar.tsx apps/admin/src/routeTree.gen.ts
git commit -m "$(printf 'feat(admin): settings page for service secrets\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
(Include the regenerated `routeTree.gen.ts`.)

---

## Self-Review Notes
- Coverage: settings table + store (T1); dynamic composio resolution + call-site migration (T2); admin settings router with allowlist + masking (T3); admin page (T4).
- Type consistency: `SettingsStore` once in ports; `AgentServices.composio` a resolver everywhere it's read; `settings.list` shape consumed by the page; `envSecretKeys` feeds `source`.
- Security: encrypted at rest, never returned, admin-gated, enum-allowlisted writable keys.
- Runtime apply: resolver re-reads the key per resolve, rebuilds the client only on change → no restart.
- YAGNI: only composio is dynamic now; registry/page generalize so resend/google follow later by making their builders resolvers + adding a registry line.
- Smoke (human): admin → Settings → paste a Composio API key → Save → immediately admin Tools shows the catalog and the account Integrations work, with no restart.
