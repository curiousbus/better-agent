# Test deploy runbook (Cloudflare Workers + Neon Postgres)

The **test** environment runs the server on **Cloudflare Workers**; its database is a **Neon Postgres** (same `pg` schema + migrations as production — full parity). Production stays Node + Postgres.

## Workflow (no local deploys)

1. Do all work on the **`dev`** branch.
2. **Push `dev`** → the `Deploy test (Workers)` GitHub Action runs two jobs:
   - `server`: install → typecheck → migrate the Neon DB → seed the built-in admin → deploy the server Worker (uploads its secrets).
   - `frontends` (matrix: web, admin): build each in TanStack Start **SPA mode** → deploy as an assets-only Worker.
3. Test against the deployed URLs:
   - server: `https://better-agent-server.jacksonwen001.workers.dev`
   - web: `https://better-agent-web.jacksonwen001.workers.dev`
   - admin: `https://better-agent-admin.jacksonwen001.workers.dev`
4. When it checks out, merge `dev → main`.

Never run `wrangler deploy` locally — deploys go through the Action.

## One-time setup (already done)

GitHub repo secrets (Settings → Secrets and variables → Actions):

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers deploy auth |
| `CLOUDFLARE_ACCOUNT_ID` | CF account |
| `DATABASE_URL` | Neon Postgres connection string (used for migrate + the Worker) |
| `AUTH_JWT_SECRET` | JWT signing (≥32 chars) |
| `CREDENTIALS_SECRET` | secret-box key (≥32 chars) |
| `CORS_ORIGIN` | allowed origins (comma-separated: deployed web/admin + localhost) |
| `SEED_ADMIN_EMAIL` | built-in admin email seeded on every deploy (`jacksonwen001@gmail.com`) |
| `SEED_ADMIN_PASSWORD` | that admin's password (used by the seed step; rotate via `gh secret set`) |

> ⚠️ The Neon password and the Cloudflare API token were shared in chat — **rotate both** and update the corresponding GitHub secrets when convenient.

## Adding more config

- Non-secret vars (e.g. `NODE_ENV`) live in `wrangler.jsonc` under `[env.test].vars`.
- New secrets (e.g. provider API keys for server-side calls): add the GitHub repo secret, then list its name under `secrets:` and pass it in `env:` in `.github/workflows/deploy-test.yml`. (User-supplied composio keys are per-user and stored in the DB, not here.)

## Frontends

`apps/web` / `apps/admin` are deployed by this Action as **assets-only Workers** (pure SPA). They build with `VITE_SERVER_URL` baked in (pointing at the server Worker) and run in TanStack Start **SPA mode**: a static shell is prerendered and the client does all data fetching. This is required because a frontend Worker can't reach the API Worker via a server-to-server `fetch` during SSR (it 500s with `HTTPError` / `No such module "react"` under the `cloudflare_module` preset). Each app's `wrangler.toml` serves `.output/public` with `not_found_handling = "single-page-application"`; the Action copies the prerendered `_shell.html` to `index.html` for the SPA fallback.

The deployed web/admin origins must be present in `CORS_ORIGIN` so the browser can call the server Worker.

## Built-in admin

The admin app (`apps/admin`) uses **email + password only** (no magic-link / reset). The `seed-admin` step (`apps/server/src/seed-admin.ts`, run after migrate) upserts `SEED_ADMIN_EMAIL` with `SEED_ADMIN_PASSWORD` and sets it admin. Admin access in the API is granted by email (`isAdminEmail`), and `jacksonwen001@gmail.com` is the hardcoded super-admin — so seeding that email guarantees admin access. To change the password: `gh secret set SEED_ADMIN_PASSWORD` then re-run the Action.

## Known limitation

Workers are stateless per request, so the in-memory `pending-tool-call` / `session-lock` / `cancellation` stores don't coordinate across requests — plain chat streaming works, but the **remote (client-executed) tool loop** needs a Durable Object (deferred). composio tools run server-side and are unaffected.
