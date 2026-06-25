# Password Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Add email+password sign-in AND sign-up to the web login page, coexisting with magic-link. Set/change password from the account page.

**Architecture:** `users` gains a nullable `password_hash` (scrypt, salted). New public `auth.registerWithPassword` / `auth.loginWithPassword` (rate-limited, enumeration-safe), plus `account.setPassword` (userProcedure) and `me.hasPassword`. The web login page gets Sign-in / Create-account modes + a magic-link fallback; the account page gets a password section. Web only (admin keeps magic-link).

**Tech Stack:** TypeScript, Node `crypto` (scrypt/timingSafeEqual — already used in secret-box), Drizzle, oRPC, TanStack Router/Query.

## Global Constraints

- Password hashing uses Node `scrypt` with a per-password random salt; verify with `timingSafeEqual`. No new dependency.
- Anti-enumeration: `loginWithPassword` returns ONE generic error ("Invalid email or password") for unknown-email / no-password / wrong-password, and ALWAYS runs a scrypt verify (against a dummy hash when needed) so timing doesn't leak existence.
- Reuse the existing `RateLimiter` (`context.services.rateLimiter` + `context.clientIp`) on register + login.
- Password min length 8 (zod).
- No email-verification on password signup (documented trade-off; magic link remains the verified path). Registering a taken email → `CONFLICT`.
- Flat UI: the login page must NOT use `Card`/border boxes (flatten it).
- Functions ≤50, file ≤300, no `any`, conventional-commits, footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit bare (never pipe through grep/head).

---

### Task 1: Backend — password hashing + register/login + set-password

**Files:**
- Modify: `packages/db/src/schema/auth.ts` (`password_hash`) + generate/apply migration
- Create: `packages/agent/src/crypto/password.ts` + `.test.ts`
- Modify: `packages/agent/src/auth/types.ts` (a credential type if needed)
- Modify: `packages/agent/src/ports.ts` (`UserStore`: `createWithPassword`, `setPasswordHash`, `findCredentialByEmail`, `hasPassword`)
- Modify: `packages/db/src/repositories/auth-store.ts`
- Modify: `packages/agent/src/testing/fakes.ts` / fake user store (new methods)
- Modify: `packages/api/src/routers/auth.ts` (register/login + me.hasPassword + rate limits)
- Modify: `packages/api/src/routers/account.ts` (`setPassword`)
- Modify: `packages/api/src/routers/account.test.ts` + `auth.test.ts`
- Create test: password-login coverage

- [ ] **Step 1: schema + migration**

`packages/db/src/schema/auth.ts` `users` += `passwordHash: text("password_hash"),`. Run `pnpm db:generate` then `pnpm db:migrate`. Commit the migration.

- [ ] **Step 2: `password.ts` (scrypt) + tests**

```ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;
const SALT_BYTES = 16;
// A valid scrypt string for an unguessable secret — used to equalize timing on
// the "no such user / no password" path so login can't be used to enumerate.
export const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(32).toString("hex"));

export function hashPassword(plain: string): string {
	const salt = randomBytes(SALT_BYTES).toString("hex");
	const hash = scryptSync(plain, salt, KEYLEN).toString("hex");
	return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
	const parts = stored.split(":");
	if (parts.length !== 3 || parts[0] !== "scrypt") {
		return false;
	}
	const expected = Buffer.from(parts[2], "hex");
	const actual = scryptSync(plain, parts[1], KEYLEN);
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}
```
(Note `DUMMY_PASSWORD_HASH` references `hashPassword` — declare the function first, or compute the dummy lazily/below the function. Order so it works.) Tests: hash→verify round-trips true; wrong password false; tampered/garbage stored false; two hashes of the same password differ (random salt).

- [ ] **Step 3: `UserStore` ports + impl**

`ports.ts` `UserStore` add:
```ts
	createWithPassword(email: string, passwordHash: string): Promise<User>;
	setPasswordHash(userId: string, passwordHash: string): Promise<void>;
	findCredentialByEmail(email: string): Promise<{ id: string; email: string; passwordHash: string | null } | null>;
	hasPassword(userId: string): Promise<boolean>;
```
Implement in `auth-store.ts`. `findCredentialByEmail` selects id/email/passwordHash by email (lowercased? emails are stored as-is — match the existing findByEmail casing). Update the fake user store to satisfy the interface.

- [ ] **Step 4: auth router — register + login + me.hasPassword**

In `auth.ts` (reuse the existing `enforce`/rate-limit helper + `issueTokens`):
```ts
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "@better-agent/agent/crypto/password";

const PASSWORD_MIN = 8;
const passwordInput = z.object({ email: z.email(), password: z.string().min(PASSWORD_MIN) });
const LIMIT_PASSWORD_IP = 20;
const LIMIT_PASSWORD_EMAIL = 10;
```
`registerWithPassword: publicProcedure.input(passwordInput).handler(...)`:
- enforce per-IP + per-email limits.
- if `stores.user.findByEmail(email)` exists → `throw new ORPCError("CONFLICT", { message: "An account with this email already exists" })`.
- else `const user = await stores.user.createWithPassword(email, hashPassword(password));` → `return issueTokens(context, user)`.

`loginWithPassword: publicProcedure.input(passwordInput).handler(...)`:
- enforce per-IP + per-email limits.
- `const cred = await stores.user.findCredentialByEmail(email);`
- `const ok = verifyPassword(password, cred?.passwordHash ?? DUMMY_PASSWORD_HASH);` (ALWAYS runs scrypt).
- if `!cred || !cred.passwordHash || !ok` → `throw new ORPCError("UNAUTHORIZED", { message: "Invalid email or password" })`.
- else `return issueTokens(context, { id: cred.id, email: cred.email })`.

`me` handler: add `hasPassword: await context.services.stores.user.hasPassword(context.authedUser.id)` to the returned object (make the handler async).

- [ ] **Step 5: `account.setPassword`**

In `account.ts`:
```ts
setPassword: userProcedure
	.input(z.object({ password: z.string().min(8) }))
	.handler(async ({ input, context }) => {
		await context.services.stores.user.setPasswordHash(
			context.authedUser.id,
			hashPassword(input.password)
		);
		return { ok: true };
	}),
```

- [ ] **Step 6: tests**

- `password.test.ts` (Step 2).
- auth: `registerWithPassword` creates + returns tokens; duplicate email → CONFLICT; `loginWithPassword` success after register; wrong password → UNAUTHORIZED with the generic message; unknown email → same generic UNAUTHORIZED (not a different error). Rate-limit: exceeding login limit → TOO_MANY_REQUESTS.
- account: `setPassword` then `loginWithPassword` works; `me.hasPassword` true after set, false before. Update existing fixtures for the new store methods.

- [ ] **Step 7: verify + commit**

```bash
pnpm check-types
pnpm -F @better-agent/agent test -- password
pnpm -F @better-agent/api test
pnpm exec biome lint <changed files>
git add -A ':!docs/research'
git commit -m "$(printf 'feat(api): email+password registration and login\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: root tsc clean; password + api tests pass; lint clean.

---

### Task 2: Web — login page modes + account password section

**Files:**
- Modify: `apps/web/src/routes/login.tsx` (sign-in / create-account modes + magic-link; flatten Card)
- Modify: `apps/web/src/routes/account.tsx` (password section)

- [ ] **Step 1: login page**

Rework `LoginPage` into a flat (NO `Card`) panel with a mode toggle:
- A small segmented control or two links: "Sign in" | "Create account".
- Email + password inputs; submit calls `orpc.auth.loginWithPassword` (sign-in) or `auth.registerWithPassword` (create) — on success, `setTokens(result)` (from `@/utils/auth`) then `navigate({ to: "/" })`.
- Below: a "Email me a magic link instead" affordance that reveals/uses the existing `requestLink` flow (keep the current magic-link UX as the fallback).
- Show mutation errors (e.g. the generic "Invalid email or password" / "email already exists") as inline text.
- Replace `<Card>` with a plain `<div className="w-full max-w-sm ...">` (flat). Keep `Input`/`Button`.
- Password input `type="password"`, `autoComplete` appropriate ("current-password" for sign-in, "new-password" for create).
Read the current `login.tsx` + `apps/web/src/utils/auth.ts` (`setTokens`) + an existing route for the orpc mutation/`navigate` patterns.

- [ ] **Step 2: account password section**

In `account.tsx`, add a "Password" section: `me.hasPassword ? "Change password" : "Set a password"` heading, a password input + Save button calling `orpc.account.setPassword`. On success, toast + invalidate `me`. (Reuse the existing `me` query — extend it to read `hasPassword`.) Flat, no card.

- [ ] **Step 3: verify + commit**

```bash
pnpm -F web build
cd apps/web && pnpm exec tsc --noEmit && cd ../..
pnpm exec biome lint apps/web/src/routes/login.tsx apps/web/src/routes/account.tsx
git add apps/web/src/routes/login.tsx apps/web/src/routes/account.tsx
git commit -m "$(printf 'feat(web): password sign-in/sign-up and set-password\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: web build + tsc clean, lint clean.

---

## Self-Review Notes
- Coverage: scrypt hash/verify, register (CONFLICT on dup), login (generic error + dummy-verify anti-enumeration + rate limit), set-password, me.hasPassword, login UI modes + magic-link fallback, account password section.
- Type consistency: `findCredentialByEmail` → `{id,email,passwordHash}` used by loginWithPassword; `me` gains `hasPassword` consumed by account page.
- Security: passwords scrypt-salted, never returned; constant-time verify; enumeration-safe login; rate-limited. Documented trade-off: no email verification on password signup.
- YAGNI: no password reset flow (magic link covers recovery), no strength meter, no MFA.
