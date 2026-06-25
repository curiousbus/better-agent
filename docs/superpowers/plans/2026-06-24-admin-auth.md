# Admin Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Gate `apps/admin` behind login. Reuse the existing magic-link/JWT auth; only allowlisted admins (a built-in super admin `jacksonwen001@gmail.com` + optional `ADMIN_EMAILS`) may access admin operations.

**Architecture:** A built-in `SUPER_ADMIN_EMAIL` plus env `ADMIN_EMAILS` form the admin allowlist (carried in `authConfig`). A new `adminProcedure` = userProcedure + email-in-allowlist (else `FORBIDDEN`). Admin-only API procedures (agents mutations, all of providers) switch to it; `agents.list` becomes `userProcedure` (web still uses it). `requestLink` gains an `audience` so the magic-link email points to the right app (URLs are server-controlled env values — no open redirect). The admin app ports web's auth client + login/verify routes + an AuthBoundary that also checks `isAdmin`.

**Tech Stack:** TypeScript, oRPC, TanStack Router/Query, @t3-oss/env.

## Global Constraints

- `SUPER_ADMIN_EMAIL = "jacksonwen001@gmail.com"` is always an admin, regardless of env.
- The magic-link base URL is chosen by the server from `authConfig.webUrl`/`authConfig.adminUrl` keyed by the `audience` enum — NEVER from a client-supplied URL.
- Web must keep working: web only uses `orpc.agents.list` (verified) → keep that callable by any authed user.
- Functions ≤50, file ≤300, no `any`, conventional-commits, footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit bare (never pipe through grep/head).

---

### Task 1: Backend — adminProcedure + allowlist + audience + gating

**Files:**
- Modify: `packages/env/src/server.ts` (`ADMIN_URL`, `ADMIN_EMAILS`)
- Create: `packages/agent/src/auth/admin.ts` (`SUPER_ADMIN_EMAIL`, `isAdminEmail`)
- Create test: `packages/agent/src/auth/admin.test.ts`
- Modify: `apps/server/src/index.ts` (`authConfig` += `adminUrl`, `adminEmails`)
- Modify: `packages/api/src/services.ts` (`AgentServices.authConfig` += `adminUrl: string`, `adminEmails: string[]`)
- Modify: `packages/api/src/index.ts` (add `adminProcedure`)
- Modify: `packages/api/src/routers/auth.ts` (`requestLink` audience; `me` returns `isAdmin`)
- Modify: `packages/api/src/routers/agents.ts` (gating)
- Modify: `packages/api/src/routers/providers.ts` (gating)
- Modify: `packages/api/src/routers/auth.test.ts` + any router tests whose context needs the new authConfig fields
- Create test: a test covering `adminProcedure` allow/deny (can live in a new `packages/api/src/routers/admin-gate.test.ts` or extend an existing one)

- [ ] **Step 1: env (`packages/env/src/server.ts`)**

Add to the `server` object:
```ts
		ADMIN_URL: z.url().default("http://localhost:3002"),
		ADMIN_EMAILS: z
			.string()
			.default("")
			.transform((value) =>
				value
					.split(",")
					.map((e) => e.trim().toLowerCase())
					.filter((e) => e !== "")
			),
```

- [ ] **Step 2: `admin.ts` + test**

```ts
export const SUPER_ADMIN_EMAIL = "jacksonwen001@gmail.com";

/** True when `email` is the built-in super admin or in the allowlist. */
export function isAdminEmail(email: string, allowlist: string[]): boolean {
	const normalized = email.trim().toLowerCase();
	return normalized === SUPER_ADMIN_EMAIL || allowlist.includes(normalized);
}
```
Test: super admin true with empty allowlist; allowlisted email true; other email false; case-insensitive.

- [ ] **Step 3: authConfig (`apps/server/src/index.ts` + `services.ts`)**

In `buildAuthServices`, add to `authConfig`: `adminUrl: env.ADMIN_URL,` and `adminEmails: env.ADMIN_EMAILS,` (the env transform already yields `string[]`).
In `packages/api/src/services.ts`, extend `AgentServices.authConfig` with `adminUrl: string;` and `adminEmails: string[];`.

- [ ] **Step 4: `adminProcedure` (`packages/api/src/index.ts`)**

Mirror `userProcedure` but add the allowlist check (import `isAdminEmail` from `@better-agent/agent/auth/admin`):
```ts
export const adminProcedure = o.use(({ context, next }) => {
	const user = context.authedUser;
	if (!user) {
		throw new ORPCError("UNAUTHORIZED", { message: "Sign in required" });
	}
	if (!isAdminEmail(user.email, context.services.authConfig.adminEmails)) {
		throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
	}
	return next({ context: { authedUser: user } });
});
```
(Match the exact style of the existing `userProcedure` in this file — it may already throw on missing user; layer the admin check on the same pattern. Import `ORPCError` if not already.)

- [ ] **Step 5: `requestLink` audience + `me.isAdmin` (`auth.ts`)**

`requestLink` input: add `audience: z.enum(["web", "admin"]).default("web")`. Choose the base URL:
```ts
				const base =
					input.audience === "admin"
						? authConfig.adminUrl
						: authConfig.webUrl;
				const url = `${base}/auth/verify?token=${token}`;
```
`me` handler: return `{ ...context.authedUser, isAdmin: isAdminEmail(context.authedUser.email, context.services.authConfig.adminEmails) }` (import `isAdminEmail`).

- [ ] **Step 6: gate procedures**

`packages/api/src/routers/agents.ts`: `list` → `userProcedure`; `get`, `getToken`, `create`, `rotateToken`, `update`, `delete` → `adminProcedure` (import both from `../index`).
`packages/api/src/routers/providers.ts`: every procedure → `adminProcedure`.
Keep handler bodies unchanged.

- [ ] **Step 7: tests**

- `admin.test.ts` (Step 2).
- An admin-gate test: build a context with a non-admin `authedUser` → calling a gated procedure (e.g. `providers.catalogList` or `agents.create`) rejects `FORBIDDEN`; with the super-admin email → passes the gate. Mirror the existing router-test harness (it builds `services` incl. `authConfig` — add `adminUrl`/`adminEmails`).
- Update any existing router tests whose `authConfig` fixture now needs `adminUrl`/`adminEmails`, and any test that called a now-gated procedure as public (give it an admin `authedUser`).

- [ ] **Step 8: verify + commit**

```bash
pnpm check-types
pnpm -F @better-agent/agent test -- admin
pnpm -F @better-agent/api test
pnpm exec biome lint packages/env/src/server.ts packages/agent/src/auth/admin.ts packages/agent/src/auth/admin.test.ts apps/server/src/index.ts packages/api/src/services.ts packages/api/src/index.ts packages/api/src/routers/auth.ts packages/api/src/routers/agents.ts packages/api/src/routers/providers.ts
git add -A ':!docs/research'
git commit -m "$(printf 'feat(api): admin allowlist gate and magic-link audience\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: root tsc clean; admin + api tests pass; lint clean.

---

### Task 2: Admin app — login + auth guard (admin-gated)

**Files (port from `apps/web`):**
- Create: `apps/admin/src/utils/auth.ts` (copy `apps/web/src/utils/auth.ts` verbatim)
- Modify: `apps/admin/src/utils/orpc.ts` (replace bare client with web's auth-aware client)
- Create: `apps/admin/src/routes/login.tsx` (copy web's; request link with `audience: "admin"`)
- Create: `apps/admin/src/routes/auth.verify.tsx` (copy web's verbatim)
- Create: `apps/admin/src/components/auth-guard.tsx` (adapt web's AuthBoundary + an `isAdmin` gate)
- Modify: `apps/admin/src/routes/__root.tsx` (render `<AuthBoundary />` instead of the shell directly)

- [ ] **Step 1: token storage + orpc client**

Copy `apps/web/src/utils/auth.ts` → `apps/admin/src/utils/auth.ts` verbatim.
Rewrite `apps/admin/src/utils/orpc.ts` to match `apps/web/src/utils/orpc.ts` (the bearer-header + refresh-interceptor link, the `refreshClient`, `createQueryClient` with the toast QueryCache). Keep admin's existing exported names (`orpc`, `client`, `createQueryClient`) so `router.tsx` still imports them.

- [ ] **Step 2: login + verify routes**

Copy `apps/web/src/routes/login.tsx` → `apps/admin/src/routes/login.tsx`; in the `requestLink` mutate call pass `{ email, audience: "admin" }`. Copy `apps/web/src/routes/auth.verify.tsx` → `apps/admin/src/routes/auth.verify.tsx` verbatim (it calls `auth.verify` + `setTokens` + navigates home).

- [ ] **Step 3: AuthBoundary with admin gate (`apps/admin/src/components/auth-guard.tsx`)**

Adapt web's `auth-guard.tsx`:
- Same bootstrap (mint access token from stored refresh token), same `PUBLIC_PATHS = ["/login", "/auth/verify"]`, same redirect-to-`/login` when not authed.
- After authed, read admin status: `const me = useQuery(orpc.auth.me.queryOptions())`; while loading show the loading screen; if `me.data && !me.data.isAdmin` render a "Not authorized" screen (signed-in email + a Sign out button that logs out → clears tokens → `/login`); if admin, render the admin shell (the `SidebarProvider`/`AdminSidebar`/`Outlet` currently in `__root`, wrapped in `RouteTransition`, with `RouteProgress`).
- Move the shell markup from `__root.tsx` into an `AdminShell` here (or keep a thin shell). Keep `RouteProgress` + `RouteTransition` mounted in the authed shell.

- [ ] **Step 4: `__root.tsx`**

Replace the `<body>` contents' shell with `<AuthBoundary />` (+ `<Toaster richColors />` + `<Scripts />`). The `RouteProgress`/`RouteTransition` move into the authed shell inside AuthBoundary (so they don't run on the login screen). Keep `HeadContent`.

- [ ] **Step 5: verify + commit**

```bash
pnpm -F admin build
cd apps/admin && pnpm exec tsc --noEmit && cd ../..
pnpm exec biome lint apps/admin/src/utils/auth.ts apps/admin/src/utils/orpc.ts apps/admin/src/routes/login.tsx apps/admin/src/routes/auth.verify.tsx apps/admin/src/components/auth-guard.tsx apps/admin/src/routes/__root.tsx
git add apps/admin/src/utils/auth.ts apps/admin/src/utils/orpc.ts apps/admin/src/routes/login.tsx apps/admin/src/routes/auth.verify.tsx apps/admin/src/components/auth-guard.tsx apps/admin/src/routes/__root.tsx
git commit -m "$(printf 'feat(admin): magic-link login gated to admins\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: admin build + tsc clean, lint clean.

---

## Self-Review Notes
- Coverage: allowlist (super admin + env), adminProcedure, audience routing, procedure gating (agents mutations + providers; list stays user-level), admin login + isAdmin gate.
- Type consistency: `authConfig` gains `adminUrl`/`adminEmails` in services.ts + populated in apps/server + read by adminProcedure/auth.ts. `me` return gains `isAdmin` consumed by admin auth-guard.
- Security: magic-link URL server-chosen by audience (no open redirect); admin allowlist checked server-side on every gated call (the UI gate is convenience, not the security boundary).
- YAGNI: no admin role management UI, no per-resource permissions — flat allowlist.
