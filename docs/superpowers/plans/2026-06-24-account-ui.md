# Account Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A web account page where a signed-in user sees their email and active login sessions (device + last active + which is current), can sign out a specific device, sign out other devices, or sign out entirely.

**Architecture:** Capture `user-agent` on refresh-token creation (one migration). A new `account` router (userProcedure) lists/revokes the user's active refresh tokens; "current" is identified by the client passing its refresh token (hashed + matched). A flat `/account` page in `apps/web` with the shared motion page transition.

**Tech Stack:** TypeScript, Drizzle (`db:generate`/`db:migrate`), oRPC, TanStack Router/Query, motion (via `@better-agent/ui`).

## Global Constraints

- Use `pnpm db:generate` to create the migration from the schema edit (do NOT hand-write SQL); the shared local DB uses `db:migrate` (never `db:push`).
- Flat UI — NO card/border boxing of page content (match the rest of the app).
- Account endpoints are `userProcedure`-gated; every revoke checks ownership (`token.userId === authedUser.id`).
- `requestLink` enumeration-safety and existing auth behavior unchanged.
- Functions ≤50, file ≤300, no `any`, conventional-commits, footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit bare (never pipe through grep/head).

---

### Task 1: Backend — user-agent capture + account router

**Files:**
- Modify: `packages/db/src/schema/auth.ts` (add `user_agent`)
- Generate: a new migration under `packages/db/...` via `pnpm db:generate`
- Modify: `packages/agent/src/auth/types.ts` (`RefreshTokenRecord` += `createdAt`, `userAgent`)
- Modify: `packages/agent/src/ports.ts` (`RefreshTokenStore`: `create` += `userAgent`; add `listActiveByUser`, `revokeForUser`, `revokeOthersForUser`)
- Modify: `packages/db/src/repositories/auth-store.ts` (implement the new methods + userAgent)
- Create: `packages/agent/src/auth/user-agent.ts` (`parseUserAgent`)
- Create test: `packages/agent/src/auth/user-agent.test.ts`
- Modify: `packages/api/src/context.ts` (`userAgent`)
- Modify: `packages/api/src/routers/auth.ts` (`issueTokens` passes `userAgent`)
- Create: `packages/api/src/routers/account.ts`
- Create test: `packages/api/src/routers/account.test.ts`
- Modify: `packages/api/src/routers/index.ts` (register `account`)

**Interfaces produced (consumed by Task 2):**
```ts
// account router (userProcedure)
listLogins(input: { currentRefreshToken?: string }):
  Promise<Array<{ id: string; label: string; createdAt: Date; current: boolean }>>
revokeLogin(input: { id: string }): Promise<{ ok: true }>
revokeOthers(input: { currentRefreshToken: string }): Promise<{ ok: true }>
```

- [ ] **Step 1: schema + migration**

In `packages/db/src/schema/auth.ts`, add to `refreshTokens`:
```ts
	userAgent: text("user_agent"),
```
Run `pnpm db:generate` to emit the migration, then `pnpm db:migrate` to apply it to the shared local DB. Commit the generated migration file.

- [ ] **Step 2: `RefreshTokenRecord` (`packages/agent/src/auth/types.ts`)**

Add `createdAt: Date;` and `userAgent: string | null;` to the interface.

- [ ] **Step 3: `parseUserAgent` (`packages/agent/src/auth/user-agent.ts`) + tests**

```ts
const BROWSERS: Array<[RegExp, string]> = [
	[/Edg\//, "Edge"],
	[/OPR\/|Opera/, "Opera"],
	[/Chrome\//, "Chrome"],
	[/Safari\//, "Safari"],
	[/Firefox\//, "Firefox"],
];
const SYSTEMS: Array<[RegExp, string]> = [
	[/iPhone|iPad/, "iOS"],
	[/Android/, "Android"],
	[/Mac OS X|Macintosh/, "macOS"],
	[/Windows/, "Windows"],
	[/Linux/, "Linux"],
];

function match(ua: string, table: Array<[RegExp, string]>): string | null {
	for (const [re, name] of table) {
		if (re.test(ua)) {
			return name;
		}
	}
	return null;
}

/** Best-effort "Browser · OS" label from a user-agent string. */
export function parseUserAgent(ua: string | null): string {
	if (!ua) {
		return "Unknown device";
	}
	const browser = match(ua, BROWSERS);
	const system = match(ua, SYSTEMS);
	if (browser && system) {
		return `${browser} · ${system}`;
	}
	return browser ?? system ?? "Unknown device";
}
```
Test a Chrome/macOS UA → "Chrome · macOS", an iPhone Safari UA → "Safari · iOS", null → "Unknown device", and an Edge UA (must win over Chrome since Edge UAs contain "Chrome/") → "Edge · …".

- [ ] **Step 4: `RefreshTokenStore` ports + impl**

In `packages/agent/src/ports.ts`, change `create` to accept `userAgent: string | null` and add:
```ts
	listActiveByUser(userId: string): Promise<RefreshTokenRecord[]>;
	revokeForUser(id: string, userId: string): Promise<void>;
	revokeOthersForUser(userId: string, exceptTokenHash: string): Promise<void>;
```
In `packages/db/src/repositories/auth-store.ts` (`createRefreshTokenStore`):
- `create`: persist `userAgent`.
- `find`/list: return `createdAt` + `userAgent` on the record.
- `listActiveByUser`: rows where `userId` matches AND `revokedAt IS NULL` AND `expiresAt > now`, ordered by `createdAt` desc.
- `revokeForUser(id, userId)`: set `revokedAt=now` where `id=id AND userId=userId` (ownership in the WHERE clause).
- `revokeOthersForUser(userId, exceptTokenHash)`: set `revokedAt=now` where `userId=userId AND tokenHash != exceptTokenHash AND revokedAt IS NULL`.

Update `packages/agent/src/testing/fakes.ts` if it has a fake refresh-token store (keep it satisfying the interface).

- [ ] **Step 5: `Context.userAgent` + `issueTokens`**

`packages/api/src/context.ts`: add a `userAgent` helper (`options.context.req.header("user-agent") ?? null`) and include `userAgent` in the returned context.
`packages/api/src/routers/auth.ts` `issueTokens`: pass `userAgent: context.userAgent` into `refreshToken.create(...)`. (`issueTokens` already receives `context`.)

- [ ] **Step 6: `account` router (`packages/api/src/routers/account.ts`)**

```ts
import { hashToken } from "@better-agent/agent/crypto/auth-tokens";
import { parseUserAgent } from "@better-agent/agent/auth/user-agent";
import { z } from "zod";
import { userProcedure } from "../index";

export const accountRouter = {
	listLogins: userProcedure
		.input(z.object({ currentRefreshToken: z.string().optional() }))
		.handler(async ({ input, context }) => {
			const tokens = await context.services.stores.refreshToken.listActiveByUser(
				context.authedUser.id
			);
			const currentHash = input.currentRefreshToken
				? hashToken(input.currentRefreshToken)
				: null;
			return tokens.map((t) => ({
				id: t.id,
				label: parseUserAgent(t.userAgent),
				createdAt: t.createdAt,
				current: currentHash !== null && hashToken_matches(t, currentHash),
			}));
		}),
	// revokeLogin({ id }): revokeForUser(id, authedUser.id) -> { ok: true }
	// revokeOthers({ currentRefreshToken }): revokeOthersForUser(authedUser.id, hashToken(currentRefreshToken)) -> { ok: true }
};
```
Note: the store records hold `tokenHash`; `listActiveByUser` should return it on the record so `current` can be computed (`t.tokenHash === currentHash`). Add `tokenHash` to `RefreshTokenRecord` if not already present, OR have `listActiveByUser` compare server-side and return a `current` flag — pick the cleaner one. Implement `revokeLogin` + `revokeOthers` per the comments (full handlers, ownership-checked).

Register in `packages/api/src/routers/index.ts`: `account: accountRouter,`.

- [ ] **Step 7: tests (`account.test.ts`)**

Using the auth test harness pattern (fake stores): seed a user with 2 active refresh tokens (different userAgents); assert `listLogins` returns 2 with parsed labels and marks the one matching `currentRefreshToken` as `current:true`; `revokeLogin({id})` revokes only that token (and rejects/ignores another user's token); `revokeOthers` leaves only the current token active.

- [ ] **Step 8: verify + commit**

```bash
pnpm check-types
pnpm -F @better-agent/agent test -- "user-agent"
pnpm -F @better-agent/api test -- account
pnpm -F @better-agent/db test
pnpm exec biome lint packages/db/src/schema/auth.ts packages/agent/src/auth/types.ts packages/agent/src/auth/user-agent.ts packages/agent/src/auth/user-agent.test.ts packages/agent/src/ports.ts packages/db/src/repositories/auth-store.ts packages/api/src/context.ts packages/api/src/routers/auth.ts packages/api/src/routers/account.ts packages/api/src/routers/account.test.ts packages/api/src/routers/index.ts
git add -A ':!docs/research'
git commit -m "$(printf 'feat(api): account router and login-session listing\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: root tsc clean; new tests pass; lint clean. (`git add -A` here is to include the generated migration; exclude the research doc.)

---

### Task 2: Frontend — account page + nav + route transition

**Files:**
- Create: `apps/web/src/routes/account.tsx`
- Create: `apps/web/src/components/route-transition.tsx` (mirror admin's — wraps Outlet, keyed by pathname)
- Modify: `apps/web/src/components/auth-guard.tsx` (wrap the `AuthedShell` Outlet in `RouteTransition`)
- Modify: `apps/web/src/components/sidebar.tsx` (add Account nav item)

**Consumes from Task 1:** `orpc.account.listLogins` / `revokeLogin` / `revokeOthers`.

- [ ] **Step 1: route transition for web**

Create `apps/web/src/components/route-transition.tsx` identical to `apps/admin/src/components/route-transition.tsx` (import `PageTransition` from `@better-agent/ui/components/page-transition`, key by `useRouterState` pathname). In `auth-guard.tsx` `AuthedShell`, wrap `<Outlet />` with `<RouteTransition>…</RouteTransition>`.

- [ ] **Step 2: account page (`apps/web/src/routes/account.tsx`)**

A `createFileRoute("/account")` page. Flat layout (no card/border boxes), e.g.:
```
<div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 overflow-auto p-4 sm:p-6">
  <div>
    <div className="text-muted-foreground text-sm">Signed in as</div>
    <div className="font-medium">{me?.email}</div>
  </div>
  <div className="flex flex-col gap-2">
    <div className="text-muted-foreground text-sm">Active sessions</div>
    {logins.map(s => (
      <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-accent">
        <div className="min-w-0">
          <div className="truncate text-sm">{s.label}{s.current ? " · this device" : ""}</div>
          <div className="text-muted-foreground text-xs">last active {relativeTime(s.createdAt)}</div>
        </div>
        {s.current ? <span className="text-muted-foreground text-xs">current</span>
          : <Button size="sm" variant="ghost" onClick={() => revokeLogin.mutate({ id: s.id })}>Sign out</Button>}
      </div>
    ))}
  </div>
  <div className="flex gap-2">
    <Button variant="outline" onClick={() => revokeOthers.mutate({ currentRefreshToken })}>Sign out other devices</Button>
    <Button variant="default" onClick={signOut}>Sign out</Button>
  </div>
</div>
```
Wire with `useQuery(orpc.account.listLogins.queryOptions({ input: { currentRefreshToken } }))` and `useMutation(orpc.account.revokeLogin.mutationOptions())` etc. (read an existing web route for the exact orpc/query call shape). `currentRefreshToken` comes from `loadRefreshToken()` (utils/auth). `me` from `orpc.auth.me`. `signOut` = call `orpc.auth.logout` with the refresh token, clear tokens (utils/auth), navigate to `/login`. Invalidate the `listLogins` query after each mutation. Add a small `relativeTime(date)` helper (or inline `Intl.RelativeTimeFormat`).

- [ ] **Step 3: sidebar nav**

In `apps/web/src/components/sidebar.tsx`, add a second section item: `{ kind: "item", item: { to: "/account", label: "Account", icon: User } }` (import `User` from `lucide-react`).

- [ ] **Step 4: verify + commit**

```bash
cd apps/web && pnpm exec tsc --noEmit && cd ../..
pnpm exec biome lint apps/web/src/routes/account.tsx apps/web/src/components/route-transition.tsx apps/web/src/components/auth-guard.tsx apps/web/src/components/sidebar.tsx
pnpm -F web build
git add apps/web/src/routes/account.tsx apps/web/src/components/route-transition.tsx apps/web/src/components/auth-guard.tsx apps/web/src/components/sidebar.tsx
git commit -m "$(printf 'feat(web): account page with login-session management\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: web tsc clean, lint clean, build succeeds.

---

## Self-Review Notes
- Coverage: device capture (migration + userAgent), list/revoke/revoke-others endpoints, account page + nav + route transition.
- Type consistency: `listLogins` return shape `{id,label,createdAt,current}` matches between account.ts and account.tsx. `RefreshTokenRecord` gains createdAt/userAgent (+tokenHash if needed for current-matching).
- Ownership: every revoke scoped by `authedUser.id` in the store WHERE clause.
- YAGNI: no email-change here (separate), no geo/IP display, best-effort UA parse only.
