# Admin User & Admin Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** An admin "Users" page: list all users (customer management) with their email, verified/auth status, and an Admin toggle (admin management — grant/revoke admin via DB) plus delete. Move the admin allowlist from env-only to DB-grantable (super admin + env still always admin).

**Architecture:** `users` gains `is_admin`. `adminProcedure` now passes for the super admin OR an env-allowlisted email OR `user.is_admin === true` (DB). A new admin router (adminProcedure-gated) lists/updates/deletes users with guards (the built-in super admin can't be demoted or deleted; you can't delete yourself). An admin `/users` page drives it.

**Tech Stack:** TypeScript, Drizzle, oRPC, TanStack Router/Query.

## Global Constraints

- The built-in `SUPER_ADMIN_EMAIL` is ALWAYS admin and can never be demoted or deleted via the API.
- A user cannot delete their own account via this admin API (avoid self-lockout).
- `adminProcedure` is the security boundary (checked server-side on every gated call); the UI toggle is convenience.
- Flat UI (no card/border boxing). Functions ≤50, file ≤300, no `any`, conventional-commits, footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit bare (never pipe through grep/head).

---

### Task 1: Backend — is_admin + admin user router

**Files:**
- Modify: `packages/db/src/schema/auth.ts` (`is_admin`) + generate/apply migration
- Modify: `packages/agent/src/auth/types.ts` (an `AdminUserRow` type)
- Modify: `packages/agent/src/ports.ts` (`UserStore`: `listAll`, `setAdmin`, `isAdmin`, `deleteById`)
- Modify: `packages/db/src/repositories/auth-store.ts`
- Modify: `packages/agent/src/testing/fake-auth-stores.ts`
- Modify: `packages/api/src/index.ts` (`adminProcedure` → async + DB check)
- Create: `packages/api/src/routers/admin.ts` + `.test.ts`
- Modify: `packages/api/src/routers/index.ts` (register `admin`)

- [ ] **Step 1: schema + migration**

`users` += `isAdmin: boolean("is_admin").notNull().default(false),` (import `boolean` from drizzle-orm/pg-core). `pnpm db:generate` then `pnpm db:migrate`. Commit the migration.

- [ ] **Step 2: types + UserStore**

`packages/agent/src/auth/types.ts`:
```ts
export interface AdminUserRow {
	id: string;
	email: string;
	createdAt: Date;
	emailVerified: boolean;
	hasPassword: boolean;
	isAdmin: boolean;
}
```
`UserStore` (ports) add:
```ts
	listAll(): Promise<AdminUserRow[]>;
	setAdmin(userId: string, isAdmin: boolean): Promise<void>;
	isAdmin(userId: string): Promise<boolean>;
	deleteById(userId: string): Promise<void>;
```
Implement in `auth-store.ts`: `listAll` selects all users mapped to `AdminUserRow` (`emailVerified = email_verified_at != null`, `hasPassword = password_hash != null`, `isAdmin = is_admin`), ordered by `createdAt` desc; `setAdmin` updates `is_admin`; `isAdmin` returns the flag; `deleteById` deletes the row. Update the fake user store.

- [ ] **Step 3: `adminProcedure` DB check (`packages/api/src/index.ts`)**

Make it async and OR-in the DB flag:
```ts
export const adminProcedure = o.use(async ({ context, next }) => {
	const user = context.authedUser;
	if (!user) {
		throw new ORPCError("UNAUTHORIZED", { message: "Sign in required" });
	}
	const allowed =
		isAdminEmail(user.email, context.services.authConfig.adminEmails) ||
		(await context.services.stores.user.isAdmin(user.id));
	if (!allowed) {
		throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
	}
	return next({ context: { authedUser: user } });
});
```

- [ ] **Step 4: `admin` router (`packages/api/src/routers/admin.ts`)**

Import `SUPER_ADMIN_EMAIL` from `@better-agent/agent/auth/admin`, `adminProcedure` from `../index`, `z`.
```ts
listUsers: adminProcedure.handler(({ context }) => context.services.stores.user.listAll()),

setUserAdmin: adminProcedure
	.input(z.object({ userId: z.uuid(), isAdmin: z.boolean() }))
	.handler(async ({ input, context }) => {
		const target = await context.services.stores.user.findById(input.userId);
		if (!target) { throw new ORPCError("NOT_FOUND", { message: "User not found" }); }
		if (target.email === SUPER_ADMIN_EMAIL && !input.isAdmin) {
			throw new ORPCError("BAD_REQUEST", { message: "The super admin cannot be demoted" });
		}
		await context.services.stores.user.setAdmin(input.userId, input.isAdmin);
		return { ok: true };
	}),

deleteUser: adminProcedure
	.input(z.object({ userId: z.uuid() }))
	.handler(async ({ input, context }) => {
		if (input.userId === context.authedUser.id) {
			throw new ORPCError("BAD_REQUEST", { message: "You cannot delete your own account" });
		}
		const target = await context.services.stores.user.findById(input.userId);
		if (!target) { throw new ORPCError("NOT_FOUND", { message: "User not found" }); }
		if (target.email === SUPER_ADMIN_EMAIL) {
			throw new ORPCError("BAD_REQUEST", { message: "The super admin cannot be deleted" });
		}
		await context.services.stores.refreshToken.revokeAllForUser(input.userId);
		await context.services.stores.user.deleteById(input.userId);
		return { ok: true };
	}),
```
Register `admin: adminRouter` in `packages/api/src/routers/index.ts`.

- [ ] **Step 5: tests (`admin.test.ts`)**

Using the router harness with a DB-admin or super-admin caller: `listUsers` returns rows incl. isAdmin/emailVerified/hasPassword; `setUserAdmin` grants admin so that user then passes `adminProcedure` (call a gated proc as them); revoking the super admin → BAD_REQUEST; `deleteUser` removes a user + revokes their tokens; deleting the super admin or yourself → BAD_REQUEST; a non-admin caller → FORBIDDEN on all. Also: a user with only the DB `is_admin` flag (not in env allowlist) passes `adminProcedure`. Update fixtures for the new store methods.

- [ ] **Step 6: verify + commit**

```bash
pnpm check-types
pnpm -F @better-agent/api test
pnpm exec biome lint <changed files>
git add -A ':!docs/research'
git commit -m "$(printf 'feat(api): admin user management and db-backed admin roles\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: root tsc clean; api tests pass; lint clean.

---

### Task 2: Admin UI — Users page

**Files:**
- Create: `apps/admin/src/routes/users.tsx`
- Modify: `apps/admin/src/components/sidebar.tsx` (Users nav item)

- [ ] **Step 1: Users page**

`createFileRoute("/users")`. Flat layout (mirror `apps/admin/src/routes/agents.index.tsx`'s container, no Card). `useQuery(orpc.admin.listUsers.queryOptions())` → a table/list of rows: email, small badges/text for "verified" (emailVerified) and auth methods (hasPassword), an **Admin** toggle (a `Switch` or a Button) calling `useMutation(orpc.admin.setUserAdmin.mutationOptions())` `.mutate({ userId, isAdmin: !row.isAdmin })`, and a **Delete** button calling `orpc.admin.deleteUser`. Invalidate `listUsers` after each mutation. Surface mutation errors via `toast.error(error.message)` (so the "super admin cannot be demoted/deleted" / "cannot delete yourself" guards show). Disable the admin-toggle and delete for the super admin row — detect it by comparing against the current user from `orpc.auth.me` (if `me.email === row.email`, disable delete; the backend also enforces). Read an existing admin route (e.g. `agents.index.tsx` / `agents-card.tsx`) for the table + orpc patterns; reuse `ListToolbar`/table primitives if they fit, else a simple flat list. Keep functions ≤50 (extract a `UserRow` component).

- [ ] **Step 2: sidebar nav**

In `apps/admin/src/components/sidebar.tsx`, add `{ kind: "item", item: { to: "/users", label: "Users", icon: Users } }` (import `Users` from `lucide-react`).

- [ ] **Step 3: verify + commit**

```bash
pnpm -F admin build
cd apps/admin && pnpm exec tsc --noEmit && cd ../..
pnpm exec biome lint apps/admin/src/routes/users.tsx apps/admin/src/components/sidebar.tsx
git add apps/admin/src/routes/users.tsx apps/admin/src/components/sidebar.tsx
git commit -m "$(printf 'feat(admin): users page with admin toggle and delete\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: admin build + tsc clean, lint clean.

---

## Self-Review Notes
- Coverage: is_admin column + DB-backed adminProcedure; admin.listUsers/setUserAdmin/deleteUser with super-admin + self guards; admin Users page (list = customer mgmt, toggle = admin mgmt, delete).
- Type consistency: `AdminUserRow` from `listAll` consumed by the page; `setUserAdmin`/`deleteUser` take `{userId,...}`.
- Security: every endpoint adminProcedure-gated; super admin un-demotable/un-deletable; no self-delete; allowlist still server-side.
- YAGNI: one Users page (admins are users); no pagination/search beyond a simple list; no per-resource roles; delete revokes tokens (orphan chat sessions acceptable for MVP).
