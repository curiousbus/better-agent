# authz Admin SPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the authz worker's vanilla `ADMIN_PAGE` with a client-only Vite+React SPA (reusing `@better-agent/ui`), served by the existing Hono worker via Cloudflare Workers static assets, with login + auth-redirect + transition, avatar menu, three-section search+table+animated pagination, modal+form create, PC-80%-centered + mobile-web.

**Architecture:** New `apps/authz/app` Vite React SPA (TanStack Router + Query, `@better-agent/ui`). The Hono worker keeps `/admin/*` + `/service/*` and serves `app/dist` as static assets (`run_worker_first` for the API paths, SPA fallback for the rest). API + JWT auth unchanged.

**Tech Stack:** Vite, React 19, `@tanstack/react-router`, `@tanstack/react-query`, `@better-agent/ui`, transitions-dev CSS, Cloudflare Workers static assets, vitest.

**Spec:** `docs/superpowers/specs/2026-06-29-authz-admin-spa.md`

## Global Constraints

- **Branch:** work on `dev`; never commit to `main`. No local deploys (GitHub Action on push to `dev`).
- **File cap:** every source file ≤ 300 lines (hard, no override — `scripts/check-file-rules.js`). Split components proactively.
- **ESLint (warnings block):** `max-lines-per-function` 50 (counts `describe`/component callbacks), `complexity` 10, `max-params` 4, `no-magic-numbers` (only `-1,0,1` free — name consts like `PAGE_SIZE`), `no-non-null-assertion`, `consistent-return`, `no-explicit-any`.
- **Biome/ultracite:** interfaces over type aliases; `T[]` not `Array<T>`; no barrel files; no `import *`; no `void` operator; `useAwait` (no `async` without `await`); `useImageSize`. `// biome-ignore` does NOT suppress ESLint.
- **package.json:** NO `^`/`~`/`latest` versions (enforced) — use exact versions or `catalog:`/`workspace:`. Mirror `apps/admin`'s versions for shared deps.
- **No `Date.now()` issues** — fine in app code (browser). Session/UUID: use `crypto.randomUUID()`.
- **transitions-dev:** install `t-*` CSS into the SPA global stylesheet; keep `prefers-reduced-motion` guards.
- **Per-task verify:** `pnpm -F authz check-types`; tests `pnpm -F authz test`. After writing, `pnpm dlx ultracite fix <paths>` then confirm `git commit` succeeds.
- **API is fixed:** `/admin/login` (POST {email,password}→{token}), `/admin/codes` (GET→Code[], POST {label,source}→Code), `/admin/codes/:id/revoke` (POST→{ok}). `Code = { id, code, label, source, active, redemptions, maxRedemptions }`. JWT in `localStorage["authz_token"]`.

## File Structure

```
apps/authz/
  vite.config.ts          NEW
  tsconfig.app.json        NEW (or extend existing tsconfig for app/)
  package.json             MODIFY (deps + scripts)
  wrangler.toml            MODIFY ([assets] + run_worker_first)
  src/worker.ts            MODIFY (remove ADMIN_PAGE serving)
  src/admin-page.ts        DELETE
  app/
    index.html             NEW
    main.tsx               NEW (router + QueryClient + ThemeProvider mount)
    styles.css             NEW (tailwind/ui globals + transitions-dev t-*)
    api.ts                 NEW (fetch wrapper + typed calls + tests)
    lib/codes.ts           NEW (search filter + pagination pure helpers + tests)
    routeTree.gen.ts        generated (gitignore)
    routes/__root.tsx       NEW
    routes/login.tsx        NEW
    routes/index.tsx        NEW (dashboard)
    components/app-shell.tsx       NEW (top bar + avatar menu)
    components/settings-dialog.tsx NEW
    components/create-dialog.tsx   NEW
    components/codes-table.tsx     NEW (search+table+pagination+animation)
```

---

## Task 1: Vite + React SPA scaffold

**Files:**
- Create: `apps/authz/vite.config.ts`, `apps/authz/app/index.html`, `apps/authz/app/main.tsx`, `apps/authz/app/styles.css`, `apps/authz/app/routes/__root.tsx`, `apps/authz/app/routes/index.tsx` (placeholder)
- Modify: `apps/authz/package.json`, `apps/authz/tsconfig.json` (or add `tsconfig.app.json`)
- Reference for versions/config: `apps/admin/vite.config.ts`, `apps/admin/package.json`, `apps/admin/tsconfig.json`

**Interfaces:**
- Produces: a buildable SPA — `pnpm -F authz build` emits `apps/authz/app/dist`; `pnpm -F authz dev` serves it. A root route shell and a placeholder index route render "authz" so the build has an entry.

- [ ] **Step 1: Inspect the reference app**

Read `apps/admin/vite.config.ts`, `apps/admin/package.json`, `apps/admin/tsconfig.json`, and `apps/admin/src/router.tsx` (or equivalent) to copy the exact plugin setup, the `@tanstack/react-router` wiring, and the **exact pinned versions** of `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`, `@vitejs/plugin-react`, `vite`, `@types/react`, `@types/react-dom`, `tailwindcss`, `@tailwindcss/vite`. authz is a **plain SPA** (NOT TanStack Start), so use `@vitejs/plugin-react` + `@tanstack/react-router` with the router plugin/codegen, not `@tanstack/react-start`.

- [ ] **Step 2: Add deps + scripts to `apps/authz/package.json`**

Add to `dependencies` (exact versions copied from admin / catalog): `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`, `@better-agent/ui": "workspace:*"`, `next-themes` (for theme, if admin uses it; else a tiny local toggle). Add to `devDependencies`: `@vitejs/plugin-react`, `vite`, `@tanstack/router-plugin` (if admin uses it for codegen), `@types/react`, `@types/react-dom`, `tailwindcss`, `@tailwindcss/vite`, `vitest` (exact `4.1.9`), `jsdom` only if needed (tests are node-env, so omit). Add scripts:
```json
"dev": "vite",
"build": "vite build",
"test": "vitest run"
```
(Keep existing `check-types`, `db:generate`, `db:migrate`.) NO `^`/`~` anywhere.

- [ ] **Step 3: vite.config.ts**

Mirror admin's, but output to `app/dist` and root at `app/`. Minimal shape:
```ts
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	root: "app",
	plugins: [
		tanstackRouter({ target: "react", routesDirectory: "app/routes", generatedRouteTree: "app/routeTree.gen.ts", autoCodeSplitting: true }),
		react(),
		tailwindcss(),
	],
	resolve: { alias: { "@": new URL("./app", import.meta.url).pathname } },
	build: { outDir: "dist", emptyOutDir: true },
});
```
(Adjust plugin import/option names to match the installed `@tanstack/router-plugin` version found in admin.)

- [ ] **Step 4: index.html + main.tsx + styles.css + root/index routes**

`app/index.html`: standard Vite root with `<div id="root">` + `<script type="module" src="/main.tsx">`.

`app/styles.css`: `@import "tailwindcss";` + `@import "@better-agent/ui/globals.css";` (match how admin imports ui globals) + (transitions-dev `t-*` block added in a later task).

`app/main.tsx`: create the router from the generated tree, a `QueryClient`, and render `<RouterProvider>` inside `<QueryClientProvider>`. Mirror admin's `main.tsx`.

`app/routes/__root.tsx`: `createRootRoute` with an `<Outlet />` and the theme provider wrapper.

`app/routes/index.tsx`: placeholder `createFileRoute("/")` rendering a centered "authz admin" so the build has content.

- [ ] **Step 5: tsconfig for app**

Ensure the app sources are typechecked (add `app/**/*` to the authz tsconfig `include`, or add a `tsconfig.app.json` referenced from the root tsconfig). `check-types` (`tsc -b`) must cover `app/`.

- [ ] **Step 6: Verify build + typecheck + commit**

Run: `pnpm install` (to install new deps), then `pnpm -F authz build` (Expected: emits `app/dist/index.html` + assets) and `pnpm -F authz check-types` (Expected: clean).
```bash
git add apps/authz/vite.config.ts apps/authz/app apps/authz/package.json apps/authz/tsconfig*.json pnpm-lock.yaml
git commit -m "feat(authz): scaffold Vite+React SPA"
```
(Add `apps/authz/app/dist` and `apps/authz/app/routeTree.gen.ts` to `.gitignore` — do NOT commit generated/build output.)

---

## Task 2: Worker serves the SPA via static assets

**Files:**
- Modify: `apps/authz/wrangler.toml`, `apps/authz/src/worker.ts`
- Delete: `apps/authz/src/admin-page.ts`

**Interfaces:**
- Consumes: `app/dist` from Task 1.
- Produces: the worker serves the SPA for non-API paths and the Hono API for `/admin/*` + `/service/*`.

- [ ] **Step 1: wrangler.toml assets config**

Add:
```toml
[assets]
directory = "./app/dist"
not_found_handling = "single-page-application"
run_worker_first = ["/admin/*", "/service/*"]
```
(Confirm the exact key names against the installed wrangler version — `run_worker_first` accepts an array of route globs in recent wrangler; if the installed version differs, use the documented equivalent and note it.)

- [ ] **Step 2: Remove HTML serving from worker.ts**

Delete the `import { ADMIN_PAGE } from "./admin-page"` line and the `app.get("/", (c) => c.html(ADMIN_PAGE));` line in `buildApp`. The worker now only registers `/service/*` and `/admin/*`; all other requests fall through to static assets.

- [ ] **Step 3: Delete the old page**

`git rm apps/authz/src/admin-page.ts`.

- [ ] **Step 4: Verify + commit**

Run: `pnpm -F authz check-types` (Expected: clean — no dangling `ADMIN_PAGE` reference). Optionally `pnpm -F authz build`.
```bash
git add apps/authz/wrangler.toml apps/authz/src/worker.ts
git rm apps/authz/src/admin-page.ts
git commit -m "feat(authz): serve SPA via Workers static assets; drop ADMIN_PAGE"
```

---

## Task 3: API client + pure helpers (+ tests)

**Files:**
- Create: `apps/authz/app/api.ts`, `apps/authz/app/api.test.ts`, `apps/authz/app/lib/codes.ts`, `apps/authz/app/lib/codes.test.ts`

**Interfaces:**
- Produces:
  - `interface Code { active: boolean; code: string; id: string; label: string; maxRedemptions: number; redemptions: number; source: string }`
  - `const TOKEN_KEY = "authz_token"`
  - `function authHeaders(token: string | null): Record<string, string>` — `{}` or `{ Authorization: "Bearer "+token }`
  - `class UnauthorizedError extends Error {}`
  - `async function login(email, password): Promise<string>` (returns token; throws on !ok)
  - `async function listCodes(token): Promise<Code[]>` (throws `UnauthorizedError` on 401)
  - `async function createCode(token, input: { label: string; source: string }): Promise<Code>`
  - `async function revokeCode(token, id: string): Promise<void>`
  - `function filterCodes(codes: Code[], query: string): Code[]` (case-insensitive over code/label/source)
  - `const PAGE_SIZE = 10; function pageOf(items, page): T[]; function pageCount(total): number; function clampPage(page, total): number`

- [ ] **Step 1: Write failing tests**

`api.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { authHeaders } from "./api";

it("builds the bearer header from a token, omits when absent", () => {
	expect(authHeaders("t")).toEqual({ Authorization: "Bearer t" });
	expect(authHeaders(null)).toEqual({});
});
```
`lib/codes.test.ts`:
```ts
import { expect, it } from "vitest";
import type { Code } from "../api";
import { clampPage, filterCodes, PAGE_SIZE, pageCount, pageOf } from "./codes";

const make = (over: Partial<Code>): Code => ({
	id: "1", code: "ABC", label: "", source: "", active: true,
	redemptions: 0, maxRedemptions: 1, ...over,
});

it("filters by code/label/source case-insensitively", () => {
	const codes = [make({ code: "ALPHA" }), make({ id: "2", code: "BETA", label: "promo" })];
	expect(filterCodes(codes, "alp")).toHaveLength(1);
	expect(filterCodes(codes, "PROMO")).toHaveLength(1);
	expect(filterCodes(codes, "")).toHaveLength(2);
});

it("paginates and clamps", () => {
	const items = Array.from({ length: 23 }, (_, i) => i);
	expect(pageOf(items, 0)).toHaveLength(PAGE_SIZE);
	expect(pageCount(items.length)).toBe(3);
	expect(clampPage(5, items.length)).toBe(2);
	expect(clampPage(-1, items.length)).toBe(0);
});
```

- [ ] **Step 2: Run red** — `pnpm -F authz test` → FAIL (modules missing).

- [ ] **Step 3: Implement `api.ts`** — the `Code` interface, `TOKEN_KEY`, `authHeaders`, `UnauthorizedError`, and the four async calls using `fetch("/admin/...", { headers: { "content-type": "application/json", ...authHeaders(token) } })`. On `res.status === 401` throw `UnauthorizedError`; on other !ok throw `Error`. `login` POSTs to `/admin/login` and returns `(await res.json()).token`.

- [ ] **Step 4: Implement `lib/codes.ts`** — `PAGE_SIZE = 10`; `filterCodes` lowercases query and matches any of code/label/source; `pageOf(items, page)` slices `[page*PAGE_SIZE, +PAGE_SIZE]`; `pageCount(total)` = `Math.max(1, Math.ceil(total/PAGE_SIZE))`; `clampPage(page, total)` clamps to `[0, pageCount-1]`.

- [ ] **Step 5: Run green + commit**

Run: `pnpm -F authz test` → PASS. `pnpm -F authz check-types` → clean.
```bash
git add apps/authz/app/api.ts apps/authz/app/api.test.ts apps/authz/app/lib/codes.ts apps/authz/app/lib/codes.test.ts
git commit -m "feat(authz): typed API client + code filter/pagination helpers"
```

---

## Task 4: Login route + auth guards + transition

**Files:**
- Create: `apps/authz/app/routes/login.tsx`
- Modify: `apps/authz/app/routes/__root.tsx` (theme provider), `apps/authz/app/routes/index.tsx` (guard), `apps/authz/app/styles.css` (transitions-dev page-side-by-side + progress)

**Interfaces:**
- Consumes: `login`, `TOKEN_KEY` (Task 3).
- Produces: `/login` route; `/` guarded (redirect to `/login` if no token); `/login` redirects to `/` if a token exists.

- [ ] **Step 1: Guards**

In `routes/index.tsx` add `beforeLoad: () => { if (!localStorage.getItem(TOKEN_KEY)) throw redirect({ to: "/login" }); }`. In `routes/login.tsx` add the inverse (`if token → redirect to "/"`). Use `redirect` from `@tanstack/react-router`.

- [ ] **Step 2: Login page UI**

`login.tsx`: a centered `card` with `@better-agent/ui` `input` (email + password) + `button` "Sign in". On submit, set a `pending` state (show a progress bar — a thin animated bar at the top of the card), call `login(email, pw)`; on success `localStorage.setItem(TOKEN_KEY, token)` then `navigate({ to: "/" })`; on error show an inline message. Disable the button while pending. Keep the component ≤ 50 lines by extracting the form into a child if needed.

- [ ] **Step 3: transitions-dev page transition**

Install the **page-side-by-side** (`08-page-side-by-side.md`) `t-*` CSS into `styles.css` (root vars + the transition block + the reduced-motion guard) per the transitions-dev skill, and apply its hooks so the login↔dashboard navigation slides. Also add a small progress-bar utility (a CSS keyframe animation) for the login pending state. Preserve the `@media (prefers-reduced-motion: reduce)` block.

- [ ] **Step 4: Verify + commit**

Run: `pnpm -F authz check-types` (clean) and `pnpm -F authz build` (succeeds).
```bash
git add apps/authz/app/routes/login.tsx apps/authz/app/routes/index.tsx apps/authz/app/routes/__root.tsx apps/authz/app/styles.css
git commit -m "feat(authz): login route + auth guards + page transition"
```

---

## Task 5: App shell — top bar, avatar menu, settings dialog

**Files:**
- Create: `apps/authz/app/components/app-shell.tsx`, `apps/authz/app/components/settings-dialog.tsx`
- Modify: `apps/authz/app/routes/index.tsx` (wrap dashboard in the shell)

**Interfaces:**
- Consumes: `TOKEN_KEY` (Task 3); `@better-agent/ui` `avatar`, `dropdown-menu`, `dialog`, `button`.
- Produces: `function AppShell({ children }: { children: ReactNode })`; `function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void })`.

- [ ] **Step 1: AppShell**

A centered container (`mx-auto w-full max-w-5xl px-4` desktop ~80%, full-width padded on mobile) with a top bar: title left, avatar `dropdown-menu` right with items **Settings** (opens `SettingsDialog`) and **Logout** (`localStorage.removeItem(TOKEN_KEY)` + `navigate({to:"/login"})`). Renders `{children}` below. Keep ≤ 50-line functions (extract the menu if needed).

- [ ] **Step 2: SettingsDialog**

A `@better-agent/ui` `dialog` showing the signed-in admin email (decode from the JWT payload if feasible via a small `decodeJwtEmail(token): string | null` helper in `api.ts` — base64url-decode the middle segment, parse JSON, return `.email ?? null`; return null on any error) and a light/dark theme toggle persisted to `localStorage` (reuse the ui theme mechanism / `next-themes` if admin uses it). If `decodeJwtEmail` is added, add a unit test for it in `api.test.ts` (valid token → email; malformed → null).

- [ ] **Step 3: Wire into dashboard** — `routes/index.tsx` renders `<AppShell>…</AppShell>`.

- [ ] **Step 4: Verify + commit**

Run: `pnpm -F authz test` (any new `decodeJwtEmail` test passes), `pnpm -F authz check-types` (clean).
```bash
git add apps/authz/app/components/app-shell.tsx apps/authz/app/components/settings-dialog.tsx apps/authz/app/routes/index.tsx apps/authz/app/api.ts apps/authz/app/api.test.ts
git commit -m "feat(authz): app shell, avatar menu, settings dialog"
```

---

## Task 6: Codes dashboard — search + table + animated pagination

**Files:**
- Create: `apps/authz/app/components/codes-table.tsx`
- Modify: `apps/authz/app/routes/index.tsx` (render the dashboard data view), `apps/authz/app/styles.css` (pagination animation if a new `t-*` is needed)

**Interfaces:**
- Consumes: `listCodes`, `UnauthorizedError`, `filterCodes`, `pageOf`, `pageCount`, `clampPage`, `PAGE_SIZE`, `Code` (Tasks 3); `@better-agent/ui` `table`, `input`, `pagination`, `skeleton`.
- Produces: `function CodesTable({ codes, onRevoke }: { codes: Code[]; onRevoke: (id: string) => void })` (search + paginated table + animation). The route uses `useQuery` to load codes and handles 401 → logout.

- [ ] **Step 1: Data load in the route**

`routes/index.tsx`: `useQuery({ queryKey: ["codes"], queryFn: () => listCodes(localStorage.getItem(TOKEN_KEY)) })`. On `UnauthorizedError` (query error), clear token + `navigate({to:"/login"})`. Loading → `skeleton` rows; error → inline message.

- [ ] **Step 2: CodesTable**

`useState` for `query` and `page`. `const filtered = filterCodes(codes, query)`; `const safePage = clampPage(page, filtered.length)`; `const rows = pageOf(filtered, safePage)`. Render: search `input` (top), `table` (Code/Label/Source/Used/action), `pagination` (bottom) driven by `pageCount(filtered.length)`. Changing the search resets `page` to 0. Used column shows `redemptions/maxRedemptions` or a "revoked" muted label; Revoke button only for `active` codes calls `onRevoke(id)`.

- [ ] **Step 3: Pagination animation**

Animate the table body on page change with a transitions-dev transition (page-side-by-side already installed in Task 4, or a row reveal). Apply a key on the `<tbody>`/rows tied to `safePage` so the transition re-fires; respect reduced-motion. Keep functions ≤ 50 lines (extract `<CodeRow>` and the toolbar).

- [ ] **Step 4: Verify + commit**

Run: `pnpm -F authz check-types` (clean), `pnpm -F authz build` (succeeds), `pnpm -F authz test` (helpers still green).
```bash
git add apps/authz/app/components/codes-table.tsx apps/authz/app/routes/index.tsx apps/authz/app/styles.css
git commit -m "feat(authz): codes dashboard — search, table, animated pagination"
```

---

## Task 7: Create (modal+form) + revoke (confirm)

**Files:**
- Create: `apps/authz/app/components/create-dialog.tsx`
- Modify: `apps/authz/app/routes/index.tsx` (mutations), `apps/authz/app/components/codes-table.tsx` (revoke-confirm state)

**Interfaces:**
- Consumes: `createCode`, `revokeCode` (Task 3); `@better-agent/ui` `dialog`, `input`, `label`, `button`; `@tanstack/react-query` `useMutation`.
- Produces: `function CreateDialog({ onCreated }: { onCreated: () => void })` (button → modal form → create → close → callback).

- [ ] **Step 1: CreateDialog**

A `button` "Create code" opening a `dialog` with a form (label + source `input`s, both optional). Submit → `useMutation(createCode)` → on success close + call `onCreated`; disable submit while pending; inline error on failure.

- [ ] **Step 2: Wire mutations in the route**

`routes/index.tsx`: `useMutation` for create + revoke, each `onSuccess` → `queryClient.invalidateQueries({ queryKey: ["codes"] })`. Pass `onCreated` (refetch) to `CreateDialog`; pass `onRevoke` to `CodesTable`.

- [ ] **Step 3: Revoke confirm**

In `codes-table.tsx`, the Revoke button switches to a "Confirm?" state on first click (per-row local state) and only calls `onRevoke(id)` on the second click (or via a tiny confirm popover). Avoids accidental revokes.

- [ ] **Step 4: Verify + commit**

Run: `pnpm -F authz check-types` (clean), `pnpm -F authz build` (succeeds).
```bash
git add apps/authz/app/components/create-dialog.tsx apps/authz/app/routes/index.tsx apps/authz/app/components/codes-table.tsx
git commit -m "feat(authz): modal+form create, revoke with confirm"
```

---

## Task 8: Responsive pass (PC 80% center + mobile)

**Files:**
- Modify: `apps/authz/app/components/app-shell.tsx`, `apps/authz/app/components/codes-table.tsx`, `apps/authz/app/routes/login.tsx`

**Interfaces:** no new interfaces; visual/responsive refinement only.

- [ ] **Step 1: Desktop centering** — confirm the shell container is centered with a comfortable max-width (~80%, capped, e.g. `max-w-5xl mx-auto`), consistent padding.

- [ ] **Step 2: Mobile table** — below a breakpoint (`sm`), render each code as a stacked `card` (label/value pairs) instead of a wide table row, OR wrap the table in an `overflow-x-auto`. Prefer stacked cards for readability. Top bar wraps; avatar stays reachable; dialogs go full-width (`max-sm:w-full`). Touch-sized buttons (`min-h-9`).

- [ ] **Step 3: Login mobile** — the login card is full-width with padding on small screens.

- [ ] **Step 4: Verify + commit**

Run: `pnpm -F authz check-types` (clean), `pnpm -F authz build` (succeeds).
```bash
git add apps/authz/app/components apps/authz/app/routes/login.tsx
git commit -m "feat(authz): responsive — PC 80% centered, mobile stacked"
```

---

## Task 9: Deploy — CI build step

**Files:**
- Modify: `.github/workflows/deploy-test.yml` (authz job)

**Interfaces:** none.

- [ ] **Step 1: Add the build step**

In the `authz` job, after `pnpm install --frozen-lockfile` and the migrate/seed steps, before "Deploy authz", add:
```yaml
      - name: Build authz SPA
        run: pnpm -F authz build
```
So `apps/authz/app/dist` exists for the assets upload. (The `wrangler-action` `command: deploy` then uploads the worker + the configured `[assets]` directory.)

- [ ] **Step 2: Verify + commit**

Run: `pnpm -F authz build` locally once more (Expected: `app/dist` emitted).
```bash
git add .github/workflows/deploy-test.yml
git commit -m "ci(authz): build the SPA before deploy"
```

- [ ] **Step 3: Final verification (whole feature)**

Run: `pnpm -F authz test` (helpers green), `pnpm -F authz check-types` (clean), `pnpm -F authz build` (succeeds). Then push `dev`; verify local HEAD == remote; the Action deploys; manually test `/login` → dashboard on the test env.

---

## Self-Review

**Spec coverage:** login + auth-redirect (T4) ✓; loading/progress/transition (T4) ✓; avatar menu settings/logout (T5) ✓; modal+form create (T7) ✓; three-section search+table+pagination (T6) ✓; animated pagination via transitions-dev (T4 install + T6 apply) ✓; PC 80% + mobile (T8) ✓; serve SPA from worker (T2) ✓; deploy (T9) ✓. Gaps: none.

**Placeholder scan:** config/version specifics defer to "copy from `apps/admin`" — intentional (exact pins must match the installed catalog, which the implementer reads from admin). All behavioral code is concrete.

**Type consistency:** `Code` shape defined in T3 and consumed unchanged in T6/T7; `filterCodes`/`pageOf`/`pageCount`/`clampPage`/`PAGE_SIZE`/`TOKEN_KEY`/`UnauthorizedError`/`decodeJwtEmail` defined in T3/T5 and reused with the same signatures downstream.
