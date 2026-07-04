# better-agent via docker-compose (single server)

Runs **postgres, redis, server (API), web, admin, and a Caddy reverse proxy**
on one machine. **authz and mcp stay on Cloudflare Workers** — the server calls
them over their public URLs (`AUTHZ_URL`, and the MCP server URL each user
configures in /integrations; the server is on Docker, not Workers, so it uses a
normal fetch — no service binding needed).

**Images are built in CI, not on the server.** The box is memory-constrained
and a local `docker build` OOMs, so GitHub Actions
(`.github/workflows/build-images.yml`) builds `server` / `web` / `admin` on
every push to `dev` and pushes them to **ghcr.io**. This compose file only
**pulls** those prebuilt images.

## Prerequisites
- Docker + docker compose.
- Three DNS A records → this server's IP: `agent.` / `agent-api.` / `agent-admin.trendf.top` (all **DNS only / grey cloud** so Caddy can get certs).
- Ports 80 and 443 open (Caddy fetches Let's Encrypt certs on first start).
- An R2 bucket + an S3 API token (attachments stay on Cloudflare).
- A GitHub token with `read:packages` to pull the private images.

## Setup
```bash
cd deploy/compose
cp .env.example .env      # fill in domains, secrets, R2 creds

# One-time: log in so Docker can pull the private ghcr images.
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin

docker compose pull       # fetch server/web/admin from ghcr.io
docker compose up -d      # start (NO --build)
```
First run: pulls images, runs DB migrations (the `migrate` one-shot, which the
server waits on), then starts everything. Caddy provisions TLS certs
automatically once DNS resolves.

## Redeploy (after CI publishes new images)
```bash
docker compose pull       # grab the new :latest images
docker compose up -d      # recreate changed containers (re-runs migrate)
```
`VITE_SERVER_URL` is baked into the web/admin images at build time from the CI
repo variable `PUBLIC_API_URL` (currently `https://agent-api.trendf.top`) —
change it there, not in `.env`, and rebuild.

## Operate
```bash
docker compose logs -f server        # tail the API
docker compose down                  # stop (data persists in named volumes)
docker compose exec postgres pg_dump -U better_agent better_agent | gzip > backup.sql.gz
```

## Notes
- Migrations run automatically on every `up` (the `migrate` service exits 0
  before `server` starts). Adding a migration = publish new images, then pull + up.
- Pin a specific build with `IMAGE_TAG=<git-sha>` in `.env`; default tracks `:latest`.
- Data lives in the `pgdata` / `redisdata` named volumes — `down` keeps them,
  `down -v` deletes them.
- To disable the invite gate, leave `AUTHZ_URL` empty.
- No k3s needed. If you later want HA/multi-node, the k3s manifests in
  `deploy/k8s` cover that; this compose file is the simple single-server path.
