# Web Auth — Magic Link + JWT (design)

> **Sub-project 1 of 3.** This spec covers **authentication only**. Two follow-up
> specs build on it: (2) user-scoped chat sessions (add `userId`, scope the chat
> plane to the user), and (3) the web chat UI port (centered input → chat →
> close, reusing admin's chat components). Auth is the foundation both depend on.

## Goal

Let people sign in to **apps/web** with a passwordless **magic link** (any email
allowed; sign-up and sign-in are the same flow). Issue a stateless **JWT access
token** plus a rotating **refresh token** — no server-side login sessions. The
access token authenticates API requests to `apps/server`.

## Non-goals (YAGNI)

Passwords, OAuth / "Sign in with Google", MFA, email verification beyond the
magic link itself, password reset, an account-management UI, rate limiting
(noted as a future hardening), and CSRF tokens (we use bearer tokens, not
cookies). admin (`apps/web` is the only auth'd surface) keeps its current
no-auth behavior.

## Architecture overview

- **Stateless access** — a short-lived JWT (HS256) carries the user id. The API
  verifies the signature only; no DB lookup per request.
- **Refresh with rotation** — a long-lived opaque token, stored **hashed** in
  `refresh_tokens`, exchanges for a new access token and is rotated each use.
  This is the only auth state and it is not a login session: it exists to allow
  logout/revocation and theft detection.
- **Tokens live client-side** — web keeps the access token in memory and the
  refresh token in `localStorage`, and sends them over headers/body (no
  cookies), so the cross-origin web(:3001) → server(:3000) setup needs no
  cookie/CORS-credentials configuration.

## Data model (Drizzle, `packages/db/src/schema/auth.ts`)

Custom table names avoid the foreign `user`/`session`/`account`/`verification`
tables already in the shared local DB and this project's chat `sessions`.

- **`users`** — `id` uuid pk, `email` text unique not null, `createdAt`,
  `updatedAt`.
- **`magic_links`** — `id` uuid pk, `tokenHash` text unique not null (sha256 of
  the emailed token), `email` text not null, `expiresAt` timestamptz not null,
  `usedAt` timestamptz null, `createdAt`. One-time, short-lived (~15 min).
- **`refresh_tokens`** — `id` uuid pk, `userId` uuid not null (→ users.id),
  `tokenHash` text unique not null (sha256 of the opaque refresh token),
  `expiresAt` timestamptz not null, `revokedAt` timestamptz null, `createdAt`.

A backfill-safe additive migration (new tables only).

## Token details

- **Access token** — JWT signed HS256 with `AUTH_JWT_SECRET`. Claims:
  `{ sub: userId, email, iat, exp }`, TTL **15 min** (`ACCESS_TTL`). Library:
  **`jose`** (modern, works in Node). Verified statelessly by the API.
- **Refresh token** — opaque random `rt_<base64url(32 bytes)>`, TTL **30 days**
  (`REFRESH_TTL`). Returned to the client once; only its sha256 hash is stored.
- **Magic-link token** — opaque random `ml_<base64url(32 bytes)>`, TTL 15 min,
  single-use; only its sha256 hash is stored.

Reuse the existing sha256 helper pattern from `agent-token.ts`. New JWT helper:
`packages/agent/src/crypto/jwt.ts` — `createJwtService(secret)` →
`{ sign(claims, ttl): string; verify(token): Claims | null }`.

## Backend (`apps/server` + packages)

- **Stores** (`packages/db/src/repositories/auth-store.ts`):
  - `createUserStore(db)` — `findByEmail`, `findById`, `findOrCreate(email)`.
  - `createMagicLinkStore(db)` — `create({ tokenHash, email, expiresAt })`,
    `consume(tokenHash)` (atomically find unexpired+unused, mark `usedAt`,
    return the row or null).
  - `createRefreshTokenStore(db)` — `create({ userId, tokenHash, expiresAt })`,
    `findValid(tokenHash)`, `revoke(id)`, `revokeAllForUser(userId)`.
- **Email sender** (`apps/server`, or `packages/agent`): `createEmailSender(env)`
  behind an interface `{ sendMagicLink(email, url): Promise<void> }`. When
  `RESEND_API_KEY` is set, send via Resend from `AUTH_EMAIL_FROM`; otherwise log
  the magic-link URL to the server console (dev fallback) so the flow works
  without a key.
- **`auth` oRPC router** (`packages/api/src/routers/auth.ts`), all `publicProcedure`
  except where noted:
  - `requestLink({ email })` — validate email; create a magic link; email it
    (or log it); return `{ ok: true }`. Always returns ok (registration is open;
    no account enumeration concern).
  - `verify({ token })` — consume the magic link; `findOrCreate` the user; issue
    `{ accessToken, refreshToken, user }`; persist the refresh-token hash.
    Errors `BAD_REQUEST` on invalid/expired/used.
  - `refresh({ refreshToken })` — look up the hash; if valid, **rotate**: revoke
    the old row, insert a new one, return a new `{ accessToken, refreshToken }`.
    If a **revoked** token is presented (reuse), `revokeAllForUser` (theft
    response) and error `UNAUTHORIZED`.
  - `me()` — **userProcedure**; returns the authed user.
  - `logout({ refreshToken })` — revoke that refresh token; returns `{ ok }`.
- **Context + `userProcedure`**: `createContext` resolves `authedUser` from the
  `Authorization: Bearer <accessJwt>` header (verify JWT → load/return user).
  `userProcedure` (mirrors `agentProcedure`) throws `UNAUTHORIZED` when
  `authedUser` is null and narrows it to non-null downstream.
  - Note: today `Authorization: Bearer` carries the **agent** token for the chat
    plane. Auth endpoints are distinct procedures, so there is no conflict in
    this spec. How the chat plane consumes the user JWT is **sub-project 2's**
    decision (e.g. user JWT for the chat plane with agent as a param) — out of
    scope here.

## Frontend (apps/web)

- **Token store** (`apps/web/src/utils/auth.ts`): access token in a
  module-level variable (memory); refresh token in `localStorage`
  (`authRefreshToken`). Helpers: `getAccessToken`, `setTokens`, `clearTokens`,
  `loadRefreshToken`.
- **oRPC client wiring** (`apps/web/src/utils/orpc.ts`): RPCLink sends
  `Authorization: Bearer <accessToken>` via a dynamic `headers` function; an
  interceptor catches `UNAUTHORIZED`, calls `auth.refresh` once, stores the new
  pair, and retries. If refresh fails → clear tokens → redirect to login.
- **Bootstrap**: on app load, if a refresh token exists, call `auth.refresh` to
  obtain a fresh access token before rendering protected content.
- **Login screen** (`/login` route): one email input → "Send login link" →
  calls `requestLink` → switches to a "Check your email" confirmation. Same
  screen for sign-up and sign-in.
- **Verify route** (`/auth/verify?token=…`): on mount, call `verify({ token })`
  → `setTokens` → redirect to the app home. On error, show "This link is invalid
  or has expired" with a button back to login.
- **Auth guard**: protected routes (everything except `/login` and
  `/auth/verify`) redirect to `/login` when there is no valid session after
  bootstrap. (The web app's existing routes become protected once sub-project 3
  lands; for this spec, a single protected placeholder is enough to prove the
  guard.)

## Environment

`apps/server/.env`: `AUTH_JWT_SECRET` (≥32 chars), `RESEND_API_KEY` (optional —
dev logs the link when absent), `AUTH_EMAIL_FROM=noreply@trendf.top`,
`WEB_URL=http://localhost:3001` (used to build the magic-link URL). Added to the
`@better-agent/env/server` schema (jwt secret required; resend key optional).

## Testing

- **jwt service** (unit): sign→verify round-trip; rejects tampered/expired/wrong-
  secret tokens.
- **auth stores** (integration, PGlite): magic-link create/consume (single-use,
  expiry); refresh-token create/findValid/revoke; rotation invalidates the old.
- **auth router** (unit, fakes): `requestLink` sends/logs; `verify` issues a
  pair + find-or-creates; `refresh` rotates and rejects a reused/revoked token;
  `me`/`logout` behavior.
- Email sender is injected (a fake) in router tests; the Resend path is not hit
  in tests.

## Open seams for the next sub-projects

- `users.id` is the anchor for **sub-project 2** (`sessions.userId`, user-scoped
  chat plane).
- The web token store + oRPC wiring is what **sub-project 3** (web chat) builds
  the centered-input → chat flow on top of.
