# Composio Per-User Connections (SP3) — Design Spec

> Date: 2026-06-25. Final sub-project of the composio tool feature (SP1 server tools, SP2 per-agent toolkits, Tools admin page). Closes the account↔tools loop: a user connects their own third-party accounts (Gmail/Slack/…) so tools that need auth run on their behalf.

## Goal

On the web **account** page, a user can connect/disconnect composio integrations (toolkits that need OAuth). Once connected, the composio tools the user's agents call run with that user's credentials (composio scopes by our account `userId`, already wired in SP1).

## Verified composio SDK (installed `@composio/core@0.11`)

- **Connect:** `composio.toolkits.authorize(userId, toolkitSlug): Promise<ConnectionRequest>` — auto-creates a composio-MANAGED auth config (no OAuth client credentials needed for popular toolkits) and returns `{ id, status?, redirectUrl? }`. Send the user to `redirectUrl`. After they finish OAuth, composio marks the connection `ACTIVE` server-side automatically — **no app callback required**; the user returns to the app and the connection list shows it. (`authorize` takes no `callbackUrl`; `link()` does but requires a pre-created `authConfigId` — deferred.)
- **List:** `composio.connectedAccounts.list({ userIds: [userId] }): Promise<{ items, nextCursor, totalPages }>`; each item `{ id, status, toolkit: { slug }, createdAt, ... }`. Status enum: `INITIALIZING|INITIATED|ACTIVE|FAILED|EXPIRED|INACTIVE|REVOKED`.
- **Disconnect:** `composio.connectedAccounts.delete(id): Promise<...>` (app-level by id → we MUST ownership-check, see below).

## Architecture

1. **Port** (`packages/agent/src/tool/composio-tools.ts`):
   ```ts
   export interface ComposioConnectionMeta {
     id: string;
     toolkitSlug: string;
     status: string;
     active: boolean;   // status === "ACTIVE"
   }
   export interface ComposioService {
     // …existing…
     connect(userId: string, toolkit: string): Promise<{ redirectUrl: string }>;
     listConnections(userId: string): Promise<ComposioConnectionMeta[]>;
     disconnect(connectionId: string): Promise<void>;
   }
   ```
2. **apps/server impl** (`apps/server/src/composio.ts`):
   - `connect` → `const req = await composio.toolkits.authorize(userId, toolkit); return { redirectUrl: req.redirectUrl ?? "" };`
   - `listConnections` → `const res = await composio.connectedAccounts.list({ userIds: [userId] }); return res.items.map(mapConnection);` with a pure exported `mapConnection(item) → { id, toolkitSlug: item.toolkit.slug, status: item.status, active: item.status === "ACTIVE" }` (read-subset interface + `as`, no `any`).
   - `disconnect` → `await composio.connectedAccounts.delete(connectionId);`
3. **Router** (`packages/api/src/routers/composio.ts`) — USER-facing endpoints (`userProcedure`), alongside the existing admin `listToolkits`:
   - `connectableToolkits: userProcedure` → `{ configured, toolkits }` = `listToolkits()` filtered to `needsAuth` (graceful: null → `{configured:false,toolkits:[]}`, throw → empty). The user needs the menu of connectable services.
   - `connections: userProcedure` → the caller's connections (`svc.listConnections(authedUser.id)`; null/throw → `[]`).
   - `connect: userProcedure.input({ toolkit })` → `{ redirectUrl }` (null → NOT_FOUND "Composio not configured"; throw → BAD_REQUEST "Could not start the connection").
   - `disconnect: userProcedure.input({ id })` → **ownership-checked**: list the caller's connections, reject with NOT_FOUND if `id` isn't among them, else `svc.disconnect(id)`. (composio delete is by-id app-level, so this guard prevents disconnecting another user's account.)
4. **Web account page** (`apps/web/src/routes/account.tsx`): a new **Integrations** section. Query `orpc.composio.connectableToolkits` + `orpc.composio.connections`; merge by toolkit slug. For each connectable toolkit show a row: name/slug + a status badge (Connected/Not connected) + a button — **Connect** (calls `client.composio.connect({toolkit})` → `window.location.href = redirectUrl`) or **Disconnect** (mutation → invalidate `connections`). When `connectableToolkits.configured === false`, show a muted "Composio 未配置" note (or hide the section). After returning from OAuth the user reloads /account and sees the connection ACTIVE.

## Scope / boundaries

- In: connect (managed-auth `authorize`), list, disconnect (ownership-checked), web Integrations UI.
- Out: `link()` + callbackUrl clean-return (needs authConfig caching — deferred polish); custom OAuth apps; per-tool scopes; admin view of all users' connections; pagination of connections (MVP shows the first page).

## Error / disable behavior

- `composio: null` → `connectableToolkits.configured:false`, `connections:[]`, `connect`→NOT_FOUND. Account page shows the section as "未配置" / empty.
- `listConnections`/`connectableToolkits` throw → empty (never breaks the account page). `connect` throw → BAD_REQUEST surfaced as a toast.
- `disconnect` of an id not owned by the caller → NOT_FOUND (security).

## Testing

- `composio.test.ts` (api, userProcedure caller): `connect` returns `{redirectUrl}` from a fake; `connections` lists the caller's; `disconnect` of an un-owned id → NOT_FOUND, of an owned id → calls `svc.disconnect`; null service → graceful (`connectableToolkits.configured:false`, `connections:[]`, `connect`/`disconnect`→NOT_FOUND).
- `apps/server/composio.test.ts`: pure `mapConnection` (active iff ACTIVE; maps toolkit.slug).
- Web: build + tsc (presentational — user verifies visually; the real OAuth round-trip needs a live key + provider consent, which the user smoke-tests).

## Self-review notes

- Type consistency: `ComposioConnectionMeta` defined once; consumed by impl, router, and the account page (via router client types).
- Security: `disconnect` ownership-checked in the router (composio delete is by id, app-level).
- Graceful everywhere (null/throw → empty/NOT_FOUND); per-user via `authedUser.id`.
- YAGNI: managed-auth `authorize` (no authConfig management), no callbackUrl, first-page connections only.
- Smoke (human): set `COMPOSIO_API_KEY`; web → Account → Integrations → Connect (e.g. Gmail) → finish OAuth → return → shows Connected; an agent with that toolkit can then call its tools as you.
