# better-agent via docker-compose (single server)

Runs **postgres, redis, server (API), web, admin, and a Caddy reverse proxy**
on one machine. **authz and mcp stay on Cloudflare Workers** — the server calls
them over their public URLs (`AUTHZ_URL`, and the MCP server URL each user
configures in /integrations; the server is on Docker, not Workers, so it uses a
normal fetch — no service binding needed).

## Prerequisites
- Docker + docker compose.
- Three DNS A records → this server's IP: `api.` / `app.` / `admin.<domain>`.
- Ports 80 and 443 open (Caddy fetches Let's Encrypt certs on first start).
- An R2 bucket + an S3 API token (attachments stay on Cloudflare).

## Setup
```bash
cd deploy/compose
cp .env.example .env      # fill in domains, secrets, R2 creds
docker compose up -d --build
```
The build context is the repo root, so the whole workspace is available to the
Dockerfiles. First run: builds images, runs DB migrations (the `migrate`
one-shot, which the server waits on), then starts everything. Caddy provisions
TLS certs automatically once DNS resolves.

## Operate
```bash
docker compose logs -f server        # tail the API
docker compose up -d --build         # redeploy after a git pull (re-runs migrate)
docker compose down                  # stop (data persists in named volumes)
docker compose exec postgres pg_dump -U better_agent better_agent | gzip > backup.sql.gz
```

## Notes
- Migrations run automatically on every `up` (the `migrate` service exits 0
  before `server` starts). Adding a migration = just redeploy.
- Data lives in the `pgdata` / `redisdata` named volumes — `down` keeps them,
  `down -v` deletes them.
- To disable the invite gate, leave `AUTHZ_URL` empty.
- No k3s needed. If you later want HA/multi-node, the k3s manifests in
  `deploy/k8s` cover that; this compose file is the simple single-server path.
