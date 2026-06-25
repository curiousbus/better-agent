# Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A forgot-password flow: request a reset email → click the link → set a new password (which revokes all existing sessions). Web only.

**Architecture:** A `password_reset_tokens` table (mirrors `magic_links`, keyed by userId). `auth.requestPasswordReset` (public, rate-limited, enumeration-safe) emails a reset link via a new `EmailSender.sendPasswordReset`. `auth.resetPassword` consumes the token, sets the new scrypt hash (reuses `hashPassword`), and revokes all the user's refresh tokens. The web login page gets a "Forgot password?" mode and a new `/reset-password` route.

**Tech Stack:** TypeScript, Drizzle, oRPC, Resend, TanStack Router/Query.

## Global Constraints

- Enumeration-safe: `requestPasswordReset` ALWAYS returns `{ ok: true }` (never reveals whether the email exists).
- `resetPassword` revokes ALL the user's refresh tokens (sign out everywhere) and marks the token used (single-use).
- Reuse `hashPassword` from `@better-agent/agent/crypto/password`; reuse the rate-limit `enforce` helper.
- Flat UI. Functions ≤50, file ≤300, no `any`, conventional-commits, footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit bare (never pipe through grep/head).

---

### Task 1: Backend — reset tokens + request/reset endpoints

**Files:**
- Modify: `packages/db/src/schema/auth.ts` (`password_reset_tokens`) + generate/apply migration
- Modify: `packages/agent/src/ports.ts` (`PasswordResetStore`; `EmailSender.sendPasswordReset`)
- Modify: `packages/db/src/repositories/auth-store.ts` (`createPasswordResetStore`)
- Modify: `apps/server/src/email-sender.ts` (`sendPasswordReset` on BOTH the Resend impl and the no-key fallback)
- Modify: `apps/server/src/index.ts` (`buildAuthServices` authStores += `passwordReset`)
- Modify: `packages/api/src/services.ts` (`AgentServices.stores` += `passwordReset: PasswordResetStore`)
- Modify: `packages/api/src/routers/auth.ts` (`requestPasswordReset`, `resetPassword`)
- Modify: `packages/agent/src/testing/fake-auth-stores.ts` + fake email sender
- Modify: `packages/api/src/routers/auth.test.ts`

- [ ] **Step 1: schema + migration**

Add a `passwordResetTokens` pgTable mirroring `magicLinks` but with `userId: uuid("user_id").notNull()` instead of `email`:
```ts
export const passwordResetTokens = pgTable("password_reset_tokens", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: uuid("user_id").notNull(),
	tokenHash: text("token_hash").notNull().unique(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	usedAt: timestamp("used_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```
`pnpm db:generate` then `pnpm db:migrate`. Commit the migration.

- [ ] **Step 2: ports — `PasswordResetStore` + `EmailSender.sendPasswordReset`**

```ts
export interface PasswordResetStore {
	create(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
	/** Single-use: returns the userId and marks it used; null if missing/used/expired. */
	consume(tokenHash: string): Promise<{ userId: string } | null>;
}
```
Add to `EmailSender`: `sendPasswordReset(input: { email: string; url: string }): Promise<void>;`.
Implement `createPasswordResetStore` in `auth-store.ts` (consume = find by hash where `usedAt IS NULL AND expiresAt > now`, set `usedAt = now`, return `{userId}`; null otherwise — do the find+update atomically like `magicLink.consume`). Implement `sendPasswordReset` on the Resend impl (subject "Reset your password", link) AND the no-API-key fallback (whatever `sendMagicLink` does there — log/console). Update the fake email sender used in tests.

- [ ] **Step 3: wiring**

`apps/server/src/index.ts` `buildAuthServices`: `authStores` += `passwordReset: createPasswordResetStore(db)`.
`packages/api/src/services.ts`: `AgentServices.stores` += `passwordReset: PasswordResetStore` (import the type).

- [ ] **Step 4: endpoints (`auth.ts`)**

Reuse `generateToken`, `hashToken`, `hashPassword`, the `enforce` rate-limit helper, `authConfig.webUrl`.
```ts
const RESET_TTL_MS = 60 * 60 * 1000; // 1h
const LIMIT_RESET_IP = 20;
const LIMIT_RESET_EMAIL = 5;
```
`requestPasswordReset: publicProcedure.input(z.object({ email: z.email() })).handler(...)`:
- enforce per-IP + per-email.
- `const user = await stores.user.findByEmail(email);`
- if user: `const token = generateToken("pr_"); await stores.passwordReset.create({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) }); await emailSender.sendPasswordReset({ email, url: \`${authConfig.webUrl}/reset-password?token=${token}\` });`
- ALWAYS `return { ok: true };` (whether or not the user existed).

`resetPassword: publicProcedure.input(z.object({ token: z.string().min(1), password: z.string().min(8) })).handler(...)`:
- enforce per-IP (`reset:ip:${clientIp}`, LIMIT_RESET_IP).
- `const consumed = await stores.passwordReset.consume(hashToken(input.token));`
- if `!consumed` → `throw new ORPCError("BAD_REQUEST", { message: "This reset link is invalid or has expired" });`
- `await stores.user.setPasswordHash(consumed.userId, hashPassword(input.password));`
- `await stores.refreshToken.revokeAllForUser(consumed.userId);`
- `return { ok: true };`

- [ ] **Step 5: tests**

- `requestPasswordReset` returns ok for both existing and unknown email (same response); for an existing user it creates a token + calls the (fake) email sender; unknown email creates no token.
- `resetPassword` with a valid token sets a new password (then `loginWithPassword` with the new password works, old password fails) AND revokes refresh tokens; invalid/expired/used token → BAD_REQUEST; reusing a consumed token → BAD_REQUEST.
- Update fixtures for the new store + email method.

- [ ] **Step 6: verify + commit**

```bash
pnpm check-types
pnpm -F @better-agent/api test
pnpm exec biome lint <changed files>
git add -A ':!docs/research'
git commit -m "$(printf 'feat(api): password reset via emailed token\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: root tsc clean; api tests pass; lint clean.

---

### Task 2: Web — forgot-password + reset-password page

**Files:**
- Modify: `apps/web/src/routes/login.tsx` (a "Forgot password?" mode)
- Create: `apps/web/src/routes/reset-password.tsx`

- [ ] **Step 1: login "Forgot password?"**

Add a `"forgot"` mode to the login page: a "Forgot password?" link (visible in `signin` mode) flips to it; the forgot view is an email input + "Send reset link" → `useMutation(orpc.auth.requestPasswordReset.mutationOptions())` `.mutate({ email })`; on success show "If that email has an account, we sent a reset link." (enumeration-safe copy). A "Back to sign in" link returns. Keep it flat (no Card).

- [ ] **Step 2: `/reset-password` route**

`createFileRoute("/reset-password")` with `validateSearch` reading `token: string` (or read from `window`/router search). A new-password input (`type="password"`, minLength 8) + Confirm → `useMutation(orpc.auth.resetPassword.mutationOptions())` `.mutate({ token, password })`; on success show "Password updated — sign in" with a link to `/login` (do NOT auto-sign-in; the reset revoked sessions). On error (invalid/expired) show the error message + a link back to `/login`. This route should be reachable WITHOUT being signed in — confirm `PUBLIC_PATHS` in `auth-guard.tsx` includes `/reset-password` (add it).

- [ ] **Step 3: verify + commit**

```bash
pnpm -F web build
cd apps/web && pnpm exec tsc --noEmit && cd ../..
pnpm exec biome lint apps/web/src/routes/login.tsx apps/web/src/routes/reset-password.tsx apps/web/src/components/auth-guard.tsx
git add apps/web/src/routes/login.tsx apps/web/src/routes/reset-password.tsx apps/web/src/components/auth-guard.tsx
git commit -m "$(printf 'feat(web): forgot-password and reset-password flow\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: web build + tsc clean, lint clean.

---

## Self-Review Notes
- Coverage: reset token table, request (enumeration-safe, rate-limited) + reset (sets hash, revokes sessions, single-use), email, login forgot mode + reset page.
- Type consistency: `PasswordResetStore.consume → {userId}` used by resetPassword; `sendPasswordReset` on EmailSender. Reuses `hashPassword`/`setPasswordHash`/`revokeAllForUser`.
- Security: tokens hashed at rest, single-use, 1h TTL, rate-limited; reset revokes all sessions; enumeration-safe request; `/reset-password` is public.
- YAGNI: no auto-sign-in after reset; reuse magic-link-style token; no separate "reset email verified" logic.
