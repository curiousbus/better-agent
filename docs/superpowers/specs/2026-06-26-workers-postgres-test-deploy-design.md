# Workers + Postgres Test Deploy — Design Spec

> Date: 2026-06-26. Goal: deploy the server to **Cloudflare Workers** for a cheap (scale-to-zero) TEST environment, keeping the database on **Postgres** (via the Neon serverless driver, free Neon tier) — ONE schema, full prod parity. Production stays Node + `node-postgres`. Chosen over Workers+D1 (which would force a permanent second SQLite schema). Feasibility: `docs/research/2026-06-26-cf-workers-d1-deploy-feasibility.md`.

## What changes (and what doesn't)

- **No schema change, no migration change.** Same `pg-core` schema + drizzle-kit `postgresql` for both runtimes. The test Neon DB runs the SAME migrations as prod.
- **DB driver becomes selectable per runtime:** Node prod → `drizzle-orm/node-postgres` (`pg`); Workers test → `drizzle-orm/neon-serverless` (`@neondatabase/serverless`). Both consume the shared `schema`. To keep `pg` out of the Workers bundle, the two drivers live in separate modules; each ENTRY imports only its own.
- **`db` stops being a module singleton.** `packages/db` exports `createNodeDb()` and `createNeonDb(connectionString)`; the entry creates the db and passes it down. (Today `db = createDb()` is imported by `apps/server` and `buildServices` uses it.)
- **`buildServices(db)` takes the db as a parameter** (decoupled from the module singleton), so both entries can supply their own.
- **Two entries, one app:** keep `apps/server/src/index.ts` (Node `serve()`) for prod; add `apps/server/src/worker.ts` (`export default { fetch }`) that builds services LAZILY on first request from the Workers `env` binding (secrets aren't available at module load on Workers) and reuses the existing Hono `app` factory.
- **Config/env on Workers:** Workers vars/secrets are on the `fetch(req, env)` binding. With `nodejs_compat` (recent compat date) `process.env` is populated from them, so the existing `@better-agent/env/server` singleton MAY work as-is — to be verified in `wrangler dev`; if not, thread the binding into config.
- **Redis:** `ioredis` can't run on Workers. The test env runs with NO `REDIS_URL` → the existing in-memory fallbacks. Caveat (documented, accepted for test): Workers are stateless per request, so in-memory `pending-tool-call`/`session-lock`/`cancellation` don't coordinate across requests — plain chat streaming works; the remote client-tool loop does not (would need a Durable Object; out of scope).
- **Streaming:** enable the `fetch_iterable_type_support` compat flag for oRPC's event-iterator (`sessions.prompt`).

## Architecture

```
packages/db/src/
  index.ts        → re-exports createNodeDb (default), keeps schema export
  node-db.ts      → createNodeDb(): drizzle-orm/node-postgres   (prod)
  neon-db.ts      → createNeonDb(url): drizzle-orm/neon-serverless (workers/test)
apps/server/src/
  app.ts          → buildApp(services): the Hono app + middleware + oRPC (extracted from index.ts)
  index.ts        → Node entry: createNodeDb() → buildServices(db) → buildApp → @hono/node-server serve()
  worker.ts       → Workers entry: lazy { createNeonDb(env.DATABASE_URL) → buildServices(db) → buildApp }, export default { fetch }
wrangler.jsonc    → main=worker.ts, compat flags, [env.test] (DATABASE_URL secret)
```

`buildServices(db, …)` already receives stores built from `db`; it just needs `db` passed in instead of importing the singleton. The Hono app construction (`app.use(cors)`, the oRPC `app.use("/*", …)` handler, `onError`) is extracted into `buildApp(services)` so both entries share it.

## Driver selection (keep `pg` out of the Workers bundle)

`createNodeDb` (imports `drizzle-orm/node-postgres` + `pg`) is imported ONLY by `index.ts` (the Node entry). `createNeonDb` (imports `drizzle-orm/neon-serverless` + `@neondatabase/serverless`) is imported ONLY by `worker.ts`. Because the Workers bundle's entry is `worker.ts`, esbuild/wrangler never pulls in `node-postgres`/`pg`. `packages/db/index.ts` must NOT import either driver at the top level (only re-export `schema` + the two factory functions, where the factories' driver imports are inside the respective modules). Verify the worker bundle has no `pg`.

## Scope / boundaries

- In: dual-driver db (node-postgres + neon-serverless, shared schema), `buildServices(db)` param, `buildApp` extraction, `worker.ts` entry, `wrangler.jsonc` `[env.test]`, deps, a deploy runbook.
- Out (the human's infra, documented in the runbook): creating the Neon free DB, the Cloudflare account, `wrangler login`, `wrangler secret put`, running migrations against Neon, and the `wrangler dev` / deploy smoke tests (streaming `sessions.prompt`, crypto, a composio call). Durable-Object-backed stateful stores for the remote-tool loop on Workers (deferred).

## Testing

- Node path unchanged → existing server + db tests must still pass (the singleton refactor keeps Node behavior identical).
- Workers path is verified by **build** (`wrangler deploy --dry-run --env test` or a bundle build) + the human's `wrangler dev` smoke tests (can't run in CI without a CF account).
- A check that the worker bundle excludes `pg` (grep the dry-run output / bundle).

## Self-review notes

- Same schema + migrations for both → real prod parity (the whole point of choosing Postgres over D1).
- `db` decoupled from the singleton; `buildServices(db)` + `buildApp(services)` shared by both entries.
- `pg` isolated to the Node entry's module graph; `@neondatabase/serverless` to the Workers entry's.
- Documented caveats: Workers statelessness breaks the remote-tool loop (test env runs in-memory; fine for chat); env sourcing verified in `wrangler dev`.
- Runbook (human): Neon free DB → `DATABASE_URL` secret → `drizzle-kit migrate` against Neon → `wrangler deploy --env test` → smoke-test streaming + a composio call.
