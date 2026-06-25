# Email Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Track email verification. Magic-link sign-in marks the email verified (clicking the link proves ownership). Password-registered users are unverified until they click a magic link; a dismissible-free banner prompts them to verify (soft gate — nothing is blocked). Web only.

**Architecture:** `users` gains `email_verified_at`. The existing `auth.verify` (magic link) sets it. `me` returns `emailVerified`. The web authed shell shows a banner with a "Resend" button (which just sends a magic link via the existing `requestLink`; clicking it verifies). No new email template or token type.

**Tech Stack:** TypeScript, Drizzle, oRPC, TanStack Query.

## Global Constraints

- Soft gate: nothing is blocked for unverified users; only a banner + resend.
- Reuse the existing magic-link flow for verification (a magic link verifies on click) — no new email/token mechanism.
- Flat UI (no card/border boxing). Functions ≤50, file ≤300, no `any`, conventional-commits, footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit bare (never pipe through grep/head).

---

### Task 1: Backend — verified column + verify marks + me.emailVerified

**Files:**
- Modify: `packages/db/src/schema/auth.ts` (`email_verified_at`) + generate/apply migration
- Modify: `packages/agent/src/ports.ts` (`UserStore`: `markEmailVerified`, `isEmailVerified`)
- Modify: `packages/db/src/repositories/auth-store.ts`
- Modify: `packages/agent/src/testing/fake-auth-stores.ts`
- Modify: `packages/api/src/routers/auth.ts` (`verify` marks verified; `me.emailVerified`)
- Modify: `packages/api/src/routers/auth.test.ts` + `account.test.ts`

- [ ] **Step 1: schema + migration**

`users` += `emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),` (nullable). `pnpm db:generate` then `pnpm db:migrate`. Commit the migration.

- [ ] **Step 2: `UserStore` ports + impl**

Add to `UserStore`:
```ts
	markEmailVerified(userId: string): Promise<void>;
	isEmailVerified(userId: string): Promise<boolean>;
```
Implement in `auth-store.ts` (`markEmailVerified`: set `email_verified_at = now` where id; `isEmailVerified`: select, return `email_verified_at != null`). Update the fake user store (track a `Set<userId>` of verified, or an `emailVerifiedAt` per row).

- [ ] **Step 3: `verify` marks verified + `me.emailVerified`**

In `auth.ts` `verify` handler, after `const user = await ...stores.user.findOrCreate(consumed.email)`, add `await context.services.stores.user.markEmailVerified(user.id);` before `issueTokens`.
In the `me` handler (already async), add `emailVerified: await context.services.stores.user.isEmailVerified(context.authedUser.id),` to the returned object.

- [ ] **Step 4: tests**

- auth: after `verify` (magic link), `me.emailVerified` is true. A user created via `registerWithPassword` has `me.emailVerified` false; after a magic-link `verify` for the same email, it becomes true.
- Update fixtures for the new store methods.

- [ ] **Step 5: verify + commit**

```bash
pnpm check-types
pnpm -F @better-agent/api test
pnpm exec biome lint <changed files>
git add -A ':!docs/research'
git commit -m "$(printf 'feat(api): track email verification via magic-link sign-in\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: root tsc clean; api tests pass; lint clean.

---

### Task 2: Web — verification banner

**Files:**
- Create: `apps/web/src/components/verify-email-banner.tsx`
- Modify: `apps/web/src/components/auth-guard.tsx` (render the banner in the authed shell)

- [ ] **Step 1: banner component**

`VerifyEmailBanner`: queries `orpc.auth.me` (`useQuery(orpc.auth.me.queryOptions())`); renders nothing while pending, when `me.data?.emailVerified` is true/undefined, or on error. When `me.data && me.data.emailVerified === false`, render a thin full-width bar (flat, e.g. `bg-muted text-sm`) reading "Verify your email — check {me.data.email} for a link." plus a "Resend" `Button` (size sm, variant ghost/outline) that calls `useMutation(orpc.auth.requestLink.mutationOptions())` `.mutate({ email: me.data.email })`; on success show "Sent — check your inbox" (toast or inline). Read `apps/web/src/routes/index.tsx` for the orpc mutation/`toast` patterns.

- [ ] **Step 2: mount in the authed shell**

In `apps/web/src/components/auth-guard.tsx` `AuthedShell`, render `<VerifyEmailBanner />` inside `SidebarInset`, ABOVE the content `<div>`/Outlet (so it spans the content area, not the sidebar). Keep it out of `LoadingScreen`/login.

- [ ] **Step 3: verify + commit**

```bash
pnpm -F web build
cd apps/web && pnpm exec tsc --noEmit && cd ../..
pnpm exec biome lint apps/web/src/components/verify-email-banner.tsx apps/web/src/components/auth-guard.tsx
git add apps/web/src/components/verify-email-banner.tsx apps/web/src/components/auth-guard.tsx
git commit -m "$(printf 'feat(web): unverified-email banner with resend\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: web build + tsc clean, lint clean.

---

## Self-Review Notes
- Coverage: column + magic-link-verify marks verified + me.emailVerified + web banner/resend.
- Type consistency: `me` gains `emailVerified` consumed by the banner. Reuses `requestLink` for resend.
- Soft gate: nothing blocked; banner only. Magic link remains the verification path.
- YAGNI: no dedicated verification email template/token (magic link suffices), no hard gating, no admin/email-change here.
