# Invite-code / API-authorization system — design

**Status:** proposed (awaiting review). Nothing implemented yet.

## Goal

A standalone, independently-deployed **authorization service** ("authz"). After an
`apps/web` user logs in (existing auth), they must redeem an **invite code**.
From then on, **every `apps/web` data request to the main server must be
authorized** by the authz service. `apps/admin` and the agent plane are
**unaffected**.

## Scope / non-goals

- Applies **only to `apps/web`** user data requests. **NOT** the agent plane
  (`agentProcedure`), **NOT** `apps/admin`.
- The auth/login and the redeem endpoints themselves are **exempt** (otherwise a
  not-yet-authorized user could never log in or redeem).

## Architecture

A new peer deployable, `apps/authz` — a Cloudflare Worker (Hono), with its **own
Neon database** (separate from the main project), **own auth**, and a **minimal
built-in admin UI** to manage codes.

```
apps/web ──login──▶ main server (existing auth)         apps/admin (unchanged)
   │                     │
   │ every data request  │ userPlane middleware
   │ carries X-Invite-   ▼
   │ Code header   authz-client ──service secret──▶ apps/authz Worker ──▶ authz Neon DB
   │                                                   (codes, grants, admin)
   └────────── redirect to /invite when unauthorized ◀─┘
```

- **`apps/web` never talks to authz directly.** The **main server** mediates
  (one trust boundary; authz stays internal, reached only with a shared service
  secret). This keeps the invite system fully decoupled from clients.

## Data model (authz DB — its own)

- `invite_codes`: `id`, `code` (unique), `label`, `maxRedemptions` (int, null =
  unlimited), `redemptions` (int, default 0), `active` (bool), `createdAt`.
- `grants`: `id`, `subject` (the web user id), `codeId` (fk), `createdAt`,
  unique(`subject`). A grant means "this user redeemed a valid code = authorized".
- `admin` auth: a single built-in admin (`jacksonwen001@gmail.com` + a random
  password seeded on deploy, same pattern as the main server's seed-admin) + a
  JWT for the authz admin UI session. No self-registration.

## authz Worker API

**Admin (JWT-authed, for the authz admin UI):**
- `login(email, password)` → token
- `codes.list()` / `codes.create({label, maxRedemptions})` / `codes.revoke(id)`

**Service (machine-to-machine, called only by the main server with a shared
`AUTHZ_SERVICE_SECRET`):**
- `authorize({ subject, code })` → `{ authorized: boolean }` — true iff a grant
  exists for `subject` whose code matches `code` and is still `active`.
- `redeem({ subject, code })` → `{ authorized: boolean, reason?: string }` —
  validates the code (active, under `maxRedemptions`), creates/updates the
  `grant` for `subject`, increments `redemptions`.

## Flow

1. User logs into `apps/web` (existing main-server auth) → user info + tokens.
2. On load, `apps/web`'s `AuthzGuard` asks the main server `invite.status` → main
   server calls authz `authorize({subject: userId, code: <stored>})`.
   - authorized → continue into the app.
   - not authorized → redirect to **`/invite`**.
3. `/invite`: user enters a code → `invite.redeem({code})` → main server →
   authz `redeem({subject: userId, code})`. On success the code is **stored
   client-side** (localStorage) and the user proceeds.
4. **Every subsequent `apps/web` data request** carries an `X-Invite-Code`
   header. The main server's **authorized-user middleware** calls authz
   `authorize({subject: userId, code})`; if not authorized → `403 FORBIDDEN`.
   The web client treats that 403 by redirecting to `/invite`.

## Main server changes

- `apps/server/src/authz-client.ts` — `authorize()` / `redeem()` over HTTP to the
  authz Worker, with the `AUTHZ_SERVICE_SECRET` header.
- A new `authorizedUserProcedure = userProcedure.use(authzMiddleware)`. The
  middleware reads `X-Invite-Code` from the request, calls
  `authorize(authedUser.id, code)`, throws `FORBIDDEN` if false. Apply it to all
  **web data** routers (sessions, user-facing agent listing, account, …). Keep
  plain `userProcedure` for `auth.*`, `invite.status`, `invite.redeem`. **Never**
  apply to `agentProcedure` or admin routers.
- A small `invite` router: `status` (authorized?) + `redeem(code)`.
- Short in-process cache of `authorize` results (TTL ~60s) to soften latency
  where the runtime persists (Node prod). On Workers each request is a fresh
  isolate, so it calls authz per request — acceptable for the test env.

## apps/web changes

- `AuthzGuard` wrapping the app shell: redirects to `/invite` when unauthorized.
- `/invite` route (single input + submit). On a `403` from any data request, the
  oRPC client error handler redirects to `/invite`.
- The oRPC client attaches the stored `X-Invite-Code` header on every request.

## apps/authz (the new app) — minimal admin UI

A single page (login + a codes table: create / list / revoke), same shadcn
stack. Built in SPA mode + deployed as an assets-only Worker like web/admin; the
authz Worker also serves the service + admin APIs. Built-in admin only — **no
self-registration**.

## Deployment

- New GitHub Action job: migrate the authz Neon DB → seed its admin → deploy the
  `better-agent-authz` Worker → build+deploy the authz admin SPA.
- New secrets: `AUTHZ_DATABASE_URL`, `AUTHZ_ADMIN_EMAIL`, `AUTHZ_ADMIN_PASSWORD`,
  `AUTHZ_JWT_SECRET`, `AUTHZ_SERVICE_SECRET`. The **main server** also gets
  `AUTHZ_URL` + `AUTHZ_SERVICE_SECRET` to call authz.

## Decisions (confirmed 2026-06-26)

1. **authz has its own admin UI** (the minimal codes page).
2. **Cache, read-from-cache each request**: on redeem, the main server records
   the grant in its **own DB** (userId → code + authorizedAt). Every web data
   request reads that local grant ("cache") — no authz round-trip per request.
   authz stays the source of truth: the main server re-syncs with authz on a TTL
   / cache-miss (so revocation propagates). This satisfies "每次读取缓存就好".
3. **One-time codes** (`maxRedemptions = 1`). When generating a code, the admin
   also configures a **source** (`source` field) — for now just a free-text
   input the admin types.
