# Admin Service Settings — Design Spec

> Date: 2026-06-25. Goal: configure companion-service credentials (starting with `COMPOSIO_API_KEY`) from the admin UI, persisted encrypted in the DB, applied at runtime with NO server restart. Middleware/infra config (CORS, JWT secret, DB URL, Redis) stays env-only.

## Goal

An admin **Settings** page where an admin sets a service secret (composio API key first; extensible to others). The value is stored encrypted; services read it dynamically (DB override ?? env fallback). Setting it takes effect immediately (no restart). Secrets are never returned to the client — only a "configured / source" status.

## Architecture

1. **`settings` table** (`packages/db/src/schema/settings.ts`): `key text primary key`, `value_cipher text not null` (encrypted via the existing `SecretBox` / `CREDENTIALS_SECRET`, same as `provider_credentials.api_key_cipher`), `updatedAt`.
2. **`SettingsStore` port** (`packages/agent/src/ports.ts`): `get(key): Promise<string | null>` (decrypted plaintext, null if absent), `set(key, value): Promise<void>` (encrypts), `delete(key): Promise<void>`. DB impl holds the `SecretBox`.
3. **Dynamic composio resolver** — the key change: `AgentServices.composio` changes from a boot-fixed `ComposioService | null` to a **resolver** `() => Promise<ComposioService | null>`. apps/server builds:
   ```ts
   function buildComposioResolver(settings: SettingsStore) {
     let cache: { key: string; service: ComposioService } | null = null;
     return async () => {
       const key = (await settings.get("COMPOSIO_API_KEY")) ?? env.COMPOSIO_API_KEY ?? null;
       if (!key) { cache = null; return null; }
       if (cache?.key !== key) {
         cache = { key, service: createComposioService({ apiKey: key, toolkits: env.COMPOSIO_TOOLKITS }) };
       }
       return cache.service;
     };
   }
   ```
   One DB read per resolve (cheap PK lookup); the `Composio` client is rebuilt only when the key value changes (handles runtime updates). `COMPOSIO_TOOLKITS` stays an env default (not a secret; per-agent overrides it).
4. **Call sites** (`context.services.composio` → `await context.services.composio()`): the 5 handlers in `packages/api/src/routers/composio.ts` and the one in `user-sessions.ts` `streamUserTurn` (resolve, then pass the resolved `ComposioService | null` to `safeComposioDefs` unchanged). All test fixtures `composio: X` become `composio: () => Promise.resolve(X)`.
5. **Settings admin router** (`packages/api/src/routers/settings.ts`, `adminProcedure`-gated; register as `settings`): a server-side registry of allowlisted secret settings (start with composio):
   ```ts
   const SECRET_SETTINGS = [
     { key: "COMPOSIO_API_KEY", label: "Composio API Key", help: "用于 composio 工具与连接。设置后立即生效。" },
   ] as const;
   ```
   - `list: adminProcedure` → for each: `{ key, label, help, configured: boolean, source: "db" | "env" | "none" }`. NEVER returns the value. `source` = db when `settings.get(key)` non-null, else env when `services.envSecretKeys.includes(key)`, else none.
   - `set: adminProcedure.input({ key: z.enum(KEYS), value: z.string().min(1) })` → `settings.set(key, value)`; `{ ok: true }`.
   - `clear: adminProcedure.input({ key: z.enum(KEYS) })` → `settings.delete(key)` (revert to env fallback); `{ ok: true }`.
   - `services.envSecretKeys: string[]` (built in apps/server: the SECRET_SETTINGS keys that have a non-empty env value) so the router can report `source: "env"` without importing env.
6. **Admin Settings page** (`apps/admin/src/routes/settings.tsx` + sidebar `Settings`/`SlidersHorizontal` nav): `useQuery(orpc.settings.list)`. For each setting render a flat row: label + help + a status `Badge` ("Set in admin" / "Using env" / "Not set") + a password `Input` + **Save** (`orpc.settings.set` → invalidate list, clear the input) + **Clear** (shown when `source === "db"`; `orpc.settings.clear` → invalidate). Errors → `toast`.

## Scope / boundaries

- In: settings table + store + dynamic composio key + admin settings router + page. Composio is the first (and only wired) dynamic service.
- Out (deferred, same pattern later): making `RESEND_API_KEY` / `GOOGLE_CLIENT_ID`/`SECRET` dynamic (they stay env for now — only the registry/page generalize); multi-instance cache invalidation (single-instance memo is fine; each instance re-reads the key per resolve so a change propagates within one call); middleware/infra config (stays env).

## Security

- Values encrypted at rest (`SecretBox`, AES-256-GCM). The API NEVER returns a stored secret — only `configured`/`source`. `set`/`clear`/`list` are `adminProcedure`-gated. The `set` input is `z.enum(KEYS)` — only allowlisted keys are writable (no arbitrary key injection).

## Testing

- `settings-store` (db, PGlite): `set` then `get` round-trips through encryption; `get` of an unset key → null; `delete` removes it; the stored column is ciphertext (not plaintext).
- composio resolver: no key (no db, no env) → null; db key → a service; changing the db key rebuilds (new client); env-only key → a service.
- `settings.test.ts` (api, admin caller): `list` reports db/env/none correctly and never leaks the value; `set` writes; `clear` deletes; non-admin → FORBIDDEN; `set` with a non-allowlisted key → input rejected.
- Admin page: build + tsc (presentational; user verifies visually).

## Self-review notes

- Type consistency: `SettingsStore` once in ports; `AgentServices.composio` is a resolver everywhere; `settings.list` shape consumed by the page.
- Security: encrypted at rest, never returned, admin-gated, enum-allowlisted keys.
- Runtime apply: resolver re-reads the key each resolve, rebuilds client only on change → no restart.
- YAGNI: only composio is dynamic; registry/page are general so resend/google can follow with one line + making their builders resolvers.
