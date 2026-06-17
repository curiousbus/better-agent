# @better-agent/admin

Admin UI (TanStack Start) for managing providers, agents, and sessions.

## Develop

```bash
# backend (allow the admin origin via CORS)
CORS_ORIGIN=http://localhost:3002 pnpm -F server dev
# admin (http://localhost:3002)
pnpm -F @better-agent/admin dev
```

Set `VITE_SERVER_URL` in `apps/admin/.env` (default `http://localhost:3000`).

## UI conventions

- **List pages** use three sections: search + action (top), table (middle), pagination (bottom) — see `src/components/list/`.
- **Add / Edit** open in a modal (`Dialog`).
- **Delete** uses a popover confirmation.

## Pages

- **Providers** — refresh the models.dev catalog, manage encrypted credentials (modal add/edit, popover-confirm delete), browse models per provider.
- **Agents** — _Plan 5b._
- **Sessions** — _Plan 5c._
