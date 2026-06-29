# authz Admin SPA Design

**Status:** Design / spec (pre-implementation)
**Date:** 2026-06-29
**Authors:** jackson + Claude

## Goal

Replace the authz worker's hand-written vanilla `ADMIN_PAGE` HTML string with a
polished **client-only React + Vite SPA** (reusing `@better-agent/ui`), served by
the same Hono worker via Cloudflare Workers static assets. The invite-code
management gets: a proper login page with auth-redirect, a loading/progress
transition into the dashboard, an avatar menu (settings + logout), a three-section
layout (search + table + animated pagination), and modal+form code creation. PC
content is centered at 80% max-width; mobile-web is fully supported.

Scope is **authz only**. The animated-pagination requirement for web + admin is a
separate follow-up.

## Non-goals

- No change to the authz API (`/admin/*`, `/service/*`) or its JWT auth model.
- No SSR (TanStack *Start*) — a client-only SPA behind login is sufficient.
- No change-password / profile features (no such API exists). Settings is minimal.
- web/admin pagination animation (separate task).

## Background: what exists

`apps/authz` is a Hono Cloudflare Worker (`src/worker.ts`):
- `/admin/login` (email+password → JWT), `/admin/codes` GET (list) / POST (create),
  `/admin/codes/:id/revoke` POST — all behind a Bearer-JWT `adminGuard`.
- `/service/*` (authorize, redeem) for worker-to-worker.
- `app.get("/")` currently returns `ADMIN_PAGE` (a vanilla HTML string in
  `src/admin-page.ts`) — this is what we replace.
- Deploy: `.github/workflows/deploy-test.yml` `authz` job runs migrate + seed-admin
  then `wrangler deploy` (workingDirectory `apps/authz`).

`@better-agent/ui` already provides the needed components: `avatar`, `dialog`
(modal), `dropdown-menu`, `input`, `label`, `table`, `pagination`, `card`, `button`,
`skeleton`. The `transitions-dev` skill provides portable namespaced `t-*` CSS
transitions (page-side-by-side, skeleton/reveal, etc.).

## Architecture

```
apps/authz/
  src/worker.ts        Hono API (unchanged) + serves SPA via Workers assets
  app/                 NEW client-only Vite React SPA
    index.html
    main.tsx           router + providers (QueryClient, ThemeProvider)
    api.ts             fetch wrapper (JWT from localStorage) + typed calls
    routes/
      __root.tsx
      login.tsx        login page (auth-redirect: → / if already authed)
      index.tsx        codes dashboard (guard: → /login if no token)
    components/
      app-shell.tsx    top bar + avatar menu (settings/logout)
      codes-table.tsx  search + table + pagination (animated)
      create-dialog.tsx modal + form
      settings-dialog.tsx minimal (email + theme toggle)
  vite.config.ts       NEW (react plugin, build outDir app/dist)
  wrangler.toml        + [assets] + run_worker_first for /admin,/service
```

### Serving (Cloudflare Workers static assets)

- `vite build` outputs the SPA to `apps/authz/app/dist`.
- `wrangler.toml` gains:
  ```toml
  [assets]
  directory = "./app/dist"
  not_found_handling = "single-page-application"
  run_worker_first = ["/admin/*", "/service/*"]
  ```
  So `/admin/*` and `/service/*` hit the Worker's Hono app; every other path serves
  the SPA (with SPA fallback to `index.html` for client routes like `/login`).
- `worker.ts`: delete the `app.get("/")` + `ADMIN_PAGE` import; the Worker no longer
  serves HTML. Keep all API routes. (The `import { ADMIN_PAGE }` and
  `src/admin-page.ts` are removed.)

### New dependencies (apps/authz)

Expected and intentional (this is the "add a build" decision): `react`, `react-dom`,
`@tanstack/react-router`, `@tanstack/react-query`, `@vitejs/plugin-react`, `vite`,
`@better-agent/ui` (workspace), `@types/react`, `@types/react-dom`. Pin versions per
the repo's package-json rules (NO `^`/`~`; use `catalog:`/`workspace:` where
available — mirror `apps/admin`'s versions).

## Auth flow

- JWT stored in `localStorage` under `authz_token` (unchanged key).
- `api.ts` attaches `Authorization: Bearer <token>`; a 401 clears the token and the
  caller routes to `/login`.
- **Router guards** (`@tanstack/react-router`):
  - `/` (and any non-login route): `beforeLoad` → if no token, `redirect({to:"/login"})`.
  - `/login`: `beforeLoad` → if a token exists, `redirect({to:"/"})`.
- **Login → dashboard transition:** while `POST /admin/login` is in flight, show a
  progress bar + disabled state; on success store token and navigate to `/`, using the
  transitions-dev **page-side-by-side** transition between the two routes. Honor
  `prefers-reduced-motion`.

## UI

### App shell (dashboard)

- Centered container, `max-width` ~80% on desktop (`mx-auto w-full max-w-[80%]` with a
  sensible cap, e.g. `max-w-5xl`), full-width with padding on mobile.
- Top bar: app title (left) + **avatar dropdown** (right) using `@better-agent/ui`
  `avatar` + `dropdown-menu`: items **Settings** (opens settings dialog) and **Logout**
  (clears token, routes to `/login`).

### Three sections

1. **Search** — an `input` filtering the loaded codes client-side by code/label/source
   (case-insensitive substring). Resets pagination to page 1 on change.
2. **Table** — `@better-agent/ui` `table`: columns Code, Label, Source, Used
   (`redemptions/maxRedemptions` or "revoked"), action (Revoke for active codes).
3. **Pagination** — `@better-agent/ui` `pagination` over the filtered rows (fixed page
   size, e.g. `PAGE_SIZE = 10`). On page change, animate the table body via a
   transitions-dev transition (page-side-by-side or a row reveal) — direction-aware if
   feasible, else a cross-fade. Reduced-motion respected.

### Create (modal + form)

- A "Create code" button opens a `dialog` (modal) containing a form (label + source
  inputs, both optional per the API's `createInput` defaults). Submit → `POST
  /admin/codes` → close dialog → refetch list. Disable submit while pending; show error
  inline on failure.

### Revoke

- Per-row Revoke button → `POST /admin/codes/:id/revoke` → refetch. Confirm inline
  (button → confirming state) to avoid accidental revokes.

### Settings (minimal)

- A `dialog` showing the signed-in admin email (decoded from the JWT payload, or shown
  as "Signed in") and a light/dark **theme toggle** (persisted to localStorage). No
  profile/password API exists, so nothing more.

### Data layer

- `@tanstack/react-query`: `useQuery` for `GET /admin/codes`; `useMutation` for create
  and revoke, invalidating the codes query on success. Loading → skeleton rows;
  error → an inline error with retry.

## Error handling

- 401 anywhere → clear token + redirect to `/login` (centralized in `api.ts` / a query
  error handler).
- Network/API errors → inline message (toast via `sonner` if already available, else a
  card), never a blank screen.
- Empty state (no codes) → a friendly empty row.

## Responsive (mobile-web)

- Desktop: centered 80% width container.
- Mobile: top bar wraps; the table either switches to stacked rows (label/value pairs
  per code in a card) below a breakpoint, or scrolls horizontally — pick stacked cards
  for readability. Touch-sized buttons; dialog is full-width on small screens.

## Deploy changes

- `.github/workflows/deploy-test.yml` `authz` job: add `pnpm -F authz build` (Vite
  build) before the `wrangler deploy` step, so `app/dist` exists for the assets upload.
- `apps/authz/package.json`: add `"build": "vite build"`, `"dev": "vite"`, and a
  `"test": "vitest run"` script; add the React/Vite deps (pinned).

## Testing

Pure-logic unit tests (vitest, node env — matching the repo pattern):
- `api.ts`: builds the Authorization header from a stored token; omits it when absent;
  surfaces 401 as the sentinel that triggers logout.
- codes filtering: search predicate matches code/label/source case-insensitively.
- pagination: slicing a list into pages of `PAGE_SIZE`; page clamps when the filtered
  set shrinks.
- JWT email decode helper (if used by settings): decodes the payload email; returns null
  on a malformed token.

Component rendering is not unit-tested (repo convention); correctness of the React
shell is covered by typecheck + manual test on the deployed env.

## File structure & constraints

- Every source file ≤ 300 lines (hard cap). Split components accordingly (table,
  dialog, shell, settings each their own file).
- Functions ≤ 50 lines, complexity ≤ 10, ≤ 4 params, no `any`, no magic numbers
  (named consts: `PAGE_SIZE`, etc.). Biome+ESLint both gate (see the project lint
  gotchas).
- package.json deps pinned (no `^`/`~`); reuse `catalog:` versions.
- transitions-dev `t-*` CSS installed into the SPA's global stylesheet; reduced-motion
  guards preserved.

## Phasing

**Phase 1 (this spec):**
1. Vite + React SPA scaffold in `apps/authz/app` (config, deps, index.html, main, router).
2. Worker serves assets (wrangler `[assets]` + `run_worker_first`); remove `ADMIN_PAGE`.
3. `api.ts` + typed calls + tests.
4. Login route + auth guards + login→dashboard transition + progress.
5. App shell + avatar menu (settings/logout) + settings dialog + theme toggle.
6. Codes dashboard: search + table + animated pagination (+ filtering/pagination tests).
7. Create dialog (modal+form) + revoke (with confirm).
8. Responsive pass (PC 80% center + mobile stacked table).
9. Deploy: CI build step + verify on test env.

**Follow-up (separate):** animated pagination for web + admin (the "三个项目" requirement).

## Resolved decisions

- **Tech:** client-only Vite + React SPA (not TanStack Start), reusing `@better-agent/ui`
  + `@tanstack/react-router` + `@tanstack/react-query`.
- **Serving:** Cloudflare Workers static assets from the existing worker; API unchanged.
- **Scope:** authz only this round.
- **Settings:** minimal (email + theme toggle); no new API.
- **Pagination animation:** via transitions-dev `t-*` CSS.
