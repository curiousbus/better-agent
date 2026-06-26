# Workers + Postgres Test Deploy & CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Make the server deployable to Cloudflare Workers (test env, Postgres via Neon serverless driver — same `pg` schema as prod) and add a GitHub Action that deploys on push to `dev`. Design: `docs/superpowers/specs/2026-06-26-workers-postgres-test-deploy-design.md`.

**Workflow note:** all work happens on `dev`; the Action deploys `dev` to the Workers test env; the user merges `dev → main` after testing.

**Tech Stack:** Cloudflare Workers, Hono, oRPC, Drizzle (`node-postgres` for prod, `neon-serverless` for Workers), `@neondatabase/serverless`, wrangler, GitHub Actions.

## Global Constraints

- ONE `pg` schema + ONE migration set for both runtimes (the whole point of Postgres-over-D1). No schema change.
- Keep `pg`/`node-postgres` OUT of the Workers bundle (only the Node entry imports it; only the Worker entry imports `neon-serverless`).
- Node prod path must remain identical (existing server + db tests stay green).
- No `any`; `??` over `||`; functions ≤50; files ≤300; conventional-commits + footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit BARE. `pnpm exec biome lint <files>` from repo ROOT.

---

### Task 1: DB dual-driver + decouple the `db` singleton

**Files:**
- Modify: `packages/db/src/index.ts` (remove the singleton + the top-level driver import; export `schema` + types)
- Create: `packages/db/src/node-db.ts` (`createNodeDb`), `packages/db/src/neon-db.ts` (`createNeonDb`)
- Modify: `packages/db/package.json` (add `@neondatabase/serverless`)
- Modify: `apps/server/src/index.ts` (build the node db + pass it into `buildServices`)
- Modify: `packages/api/src/services.ts` / wherever `buildServices` lives — `buildServices` takes `db` (or the stores are built from a passed `db`)
- Find + fix every other importer of the removed `db` singleton (grep `from "@better-agent/db"` and the `db` export).

- [ ] **Step 1: driver modules**

`packages/db/src/node-db.ts`:
```ts
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
export function createNodeDb(url: string) {
	return drizzle(url, { schema });
}
```
`packages/db/src/neon-db.ts`:
```ts
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";
export function createNeonDb(url: string) {
	return drizzle(new Pool({ connectionString: url }), { schema });
}
```
Both drizzle instances satisfy the driver-agnostic `PgDatabase<PgQueryResultHKT, typeof schema>` type the stores already use (`packages/db/src/repositories/*` define `type Db = PgDatabase<…>`), so consumers accept either.

- [ ] **Step 2: index.ts — no singleton, no top-level driver import**

`packages/db/src/index.ts` becomes (drop `export const db = createDb()` and the `drizzle-orm/node-postgres` import — that import is what would pull `pg` into the Workers bundle):
```ts
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the whole schema object
import * as schema from "./schema";

export { schema };
export { createNodeDb } from "./node-db";
export { createNeonDb } from "./neon-db";
```
(If `noBarrelFile` flags this, the consumers can import `createNodeDb`/`createNeonDb` directly from `@better-agent/db/node-db` / `/neon-db`; adjust to avoid a barrel.)

- [ ] **Step 3: thread `db` into the server**

In `apps/server/src/index.ts` (the Node entry): `import { createNodeDb } from "@better-agent/db/node-db"; const db = createNodeDb(env.DATABASE_URL);` and pass `db` into `buildServices`. Make `buildServices(db, …)` accept the db param instead of importing the module singleton; the store constructors already take `db`. Fix any other singleton importers (test-db, migrate scripts) to call `createNodeDb(...)`.

- [ ] **Step 4: verify + commit**
```bash
pnpm db:generate   # ensure no schema drift
pnpm check-types
pnpm -F @better-agent/db test
pnpm -F server build
pnpm exec biome lint <changed files>
git add -A ':!docs/research'
git commit -m "$(printf 'refactor(db): dual driver (node-postgres + neon-serverless), no singleton\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: tsc clean; db + server tests pass; server build clean (Node path unchanged).

---

### Task 2: Hono app extraction + Workers entry + wrangler config

**Files:**
- Create: `apps/server/src/app.ts` (`buildApp(services): Hono`)
- Modify: `apps/server/src/index.ts` (use `buildApp`; keep `@hono/node-server` serve)
- Create: `apps/server/src/worker.ts` (Workers entry)
- Create: `wrangler.jsonc` (repo root)
- Modify: `apps/server/package.json` (add `wrangler`, `@cloudflare/workers-types` dev deps)

- [ ] **Step 1: extract `buildApp`**

Move the Hono app construction from `index.ts` into `apps/server/src/app.ts`:
```ts
export function buildApp(services: AgentServices): Hono { … }
```
It builds the `Hono` app, the `STREAMING_PATHS`/evlog middleware, `cors`, `onError`, and the oRPC `app.use("/*", …)` handler + `apiHandler`/`rpcHandler` (those can stay module-level or move inside). `index.ts` then: `const db = createNodeDb(env.DATABASE_URL); const services = buildServices(db); const app = buildApp(services); serve({ fetch: app.fetch, port: 3000 });`.

- [ ] **Step 2: Workers entry**

`apps/server/src/worker.ts` — Workers can't build services at module load (secrets are on the `env` binding), so build lazily + memoize per isolate:
```ts
import { createNeonDb } from "@better-agent/db/neon-db";
import { buildApp } from "./app";
import { buildServices } from "./services"; // wherever buildServices is

let cached: { fetch: (req: Request) => Response | Promise<Response> } | null = null;

export default {
	fetch(request: Request, environment: Record<string, string>): Response | Promise<Response> {
		if (!cached) {
			const db = createNeonDb(environment.DATABASE_URL);
			const services = buildServices(db); // sources config from process.env (nodejs_compat) or thread `environment`
			cached = buildApp(services);
		}
		return cached.fetch(request);
	},
};
```
NOTE for the implementer: `buildServices`/`env` currently read `process.env` via `@better-agent/env/server`. With `nodejs_compat` + a recent compat date, Workers populate `process.env` from vars/secrets, so the existing singleton MAY just work. If `wrangler dev` shows missing env, thread `environment` into a config object instead. Leave a clear comment; the human iterates this on `wrangler dev`. Do NOT import `node-db`/`pg`/`ioredis`/`@hono/node-server` from `worker.ts` (keep them out of the Workers bundle); the test env runs with the in-memory store fallbacks (no `REDIS_URL`).

- [ ] **Step 3: wrangler.jsonc** (repo root)
```jsonc
{
	"name": "better-agent-server",
	"main": "apps/server/src/worker.ts",
	"compatibility_date": "2025-09-23",
	"compatibility_flags": ["nodejs_compat", "fetch_iterable_type_support"],
	"env": {
		"test": {
			"vars": { "NODE_ENV": "production" }
		}
	}
}
```
(Secrets — `DATABASE_URL`, `AUTH_JWT_SECRET`, `CREDENTIALS_SECRET`, provider keys, `CORS_ORIGIN`, `WEB_URL`, `ADMIN_URL` — are NOT in this file; the human sets them with `wrangler secret put … --env test`. Document this in the runbook, Task 3.)

- [ ] **Step 4: verify the bundle**
```bash
pnpm -F server add -D wrangler @cloudflare/workers-types
pnpm check-types
npx wrangler deploy --dry-run --env test --outdir /tmp/worker-bundle 2>&1 | tail -20 || true
grep -rl "pg" /tmp/worker-bundle 2>/dev/null && echo "WARN: pg in bundle" || echo "ok: no pg in worker bundle"
```
Expected: the dry-run bundles `worker.ts`; `pg`/`node-postgres` must NOT be in the bundle (only `worker.ts`'s graph). If `wrangler` isn't authenticated, `--dry-run` still bundles without deploying. If bundling fails on a workspace/node dep, note it in the report (the human iterates on `wrangler dev`).

- [ ] **Step 5: commit**
```bash
git add apps/server/src/app.ts apps/server/src/index.ts apps/server/src/worker.ts wrangler.jsonc apps/server/package.json pnpm-lock.yaml
git commit -m "$(printf 'feat(server): cloudflare workers entry + wrangler config\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: GitHub Action — deploy dev to Workers + runbook

**Files:**
- Create: `.github/workflows/deploy-test.yml`
- Create: `docs/deploy-test-runbook.md`

- [ ] **Step 1: workflow**

`.github/workflows/deploy-test.yml` — on push to `dev`, install + typecheck + deploy via `cloudflare/wrangler-action`:
```yaml
name: Deploy test (Workers)
on:
  push:
    branches: [dev]
  workflow_dispatch: {}
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm check-types
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy --env test
```
(Adjust `node-version`/pnpm version to match the repo. If the repo pins a pnpm version in `package.json#packageManager`, `pnpm/action-setup` reads it.)

- [ ] **Step 2: runbook**

`docs/deploy-test-runbook.md` — the human's one-time setup + per-deploy flow:
1. Create a free Neon Postgres; copy the connection string.
2. Run migrations against Neon: `DATABASE_URL=<neon-url> pnpm db:migrate`.
3. `wrangler login` (or create a CF API token with Workers + D1/Workers-scripts edit perms).
4. Set GitHub repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
5. Set the Worker's runtime secrets (one-time): `wrangler secret put DATABASE_URL --env test` (Neon url), `AUTH_JWT_SECRET`, `CREDENTIALS_SECRET`, `CORS_ORIGIN`, `WEB_URL`, `ADMIN_URL`, provider API keys.
6. Push to `dev` → the Action deploys → test at the Workers URL.
7. Smoke-test: a streaming chat (`sessions.prompt`), login/token (crypto), and one composio call (verify composio runs on Workers).
8. After testing, merge `dev → main`.

- [ ] **Step 3: commit**
```bash
git add .github/workflows/deploy-test.yml docs/deploy-test-runbook.md
git commit -m "$(printf 'ci: deploy dev to cloudflare workers test env\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review Notes
- One pg schema + migrations for both runtimes (Neon test = Postgres prod parity).
- `db` singleton removed; `pg` confined to the Node entry's module graph, `neon-serverless` to the Worker's; verified by the dry-run bundle check.
- `buildApp(services)` shared by both entries; Workers builds services lazily from the `env` binding (memoized per isolate).
- Action deploys `dev`; the human sets CF + worker secrets and runs Neon migrations (runbook). The Action is the iteration loop for the Workers-specific bits (env sourcing, bundling) that can't be validated in CI here.
- Known deferred: remote client-tool loop needs a Durable Object on stateless Workers (test env runs in-memory; chat streaming is fine).
