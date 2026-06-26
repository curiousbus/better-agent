# Test deploy runbook (Cloudflare Workers + Neon Postgres)

The **test** environment runs the server on **Cloudflare Workers**; its database is a **Neon Postgres** (same `pg` schema + migrations as production — full parity). Production stays Node + Postgres.

## Workflow (no local deploys)

1. Do all work on the **`dev`** branch.
2. **Push `dev`** → the `Deploy test (Workers)` GitHub Action runs: install → typecheck → migrate the Neon DB → deploy the Worker (test env) and upload its secrets.
3. Test against the Worker URL (`https://better-agent-server-test.<your-subdomain>.workers.dev`).
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
| `CORS_ORIGIN` | allowed origins (comma-separated, e.g. local web/admin) |

> ⚠️ The Neon password and the Cloudflare API token were shared in chat — **rotate both** and update the corresponding GitHub secrets when convenient.

## Adding more config

- Non-secret vars (e.g. `NODE_ENV`) live in `wrangler.jsonc` under `[env.test].vars`.
- New secrets (e.g. provider API keys for server-side calls): add the GitHub repo secret, then list its name under `secrets:` and pass it in `env:` in `.github/workflows/deploy-test.yml`. (User-supplied composio keys are per-user and stored in the DB, not here.)

## Frontends

`apps/web` / `apps/admin` are not deployed by this Action. To test against the deployed Worker, run them locally pointing their oRPC base URL at the Worker URL, and ensure that origin is in `CORS_ORIGIN`.

## Known limitation

Workers are stateless per request, so the in-memory `pending-tool-call` / `session-lock` / `cancellation` stores don't coordinate across requests — plain chat streaming works, but the **remote (client-executed) tool loop** needs a Durable Object (deferred). composio tools run server-side and are unaffected.
