# Google OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** "Continue with Google" on the web login. Authorization-code flow: web → Google consent → `/auth/google/callback` → server exchanges the code for the (verified) email, finds-or-creates the user (linking by verified email), and issues our tokens. Disabled gracefully when no Google credentials are configured.

**Architecture:** A `GoogleOAuth` service (in `apps/server`, behind a port) builds the consent URL and exchanges the code via Google's token + userinfo endpoints (`fetch`). It's wired into `AgentServices.googleOAuth` (null when unconfigured) so it's injectable/mock-testable. `auth.googleAuthUrl` / `auth.googleSignIn` procedures use it; the login page + a public `/auth/google/callback` route drive it. Account linking is by verified email (no separate oauth table — MVP). Web only.

**Tech Stack:** TypeScript, oRPC, `fetch`, TanStack Router/Query.

## Global Constraints

- Google email MUST be verified (`email_verified === true`) before sign-in; else reject. (Google emails normally are.)
- The OAuth `redirect_uri` is server-derived from `WEB_URL` (`${WEB_URL}/auth/google/callback`) — never client-supplied.
- CSRF `state`: the web generates a random state, stores it in `sessionStorage`, and verifies it on callback before sending the code.
- `client_secret` lives only in `apps/server` env; never exposed to the client.
- Graceful disable: when `GOOGLE_CLIENT_ID`/`SECRET` are unset, `googleOAuth` is null and the procedures throw a clear "not configured" error (the web button can surface it).
- Functions ≤50, file ≤300, no `any`, conventional-commits, footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit bare (never pipe through grep/head).

---

### Task 1: Backend — GoogleOAuth service + endpoints

**Files:**
- Modify: `packages/env/src/server.ts` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — optional)
- Modify: `packages/agent/src/ports.ts` (`GoogleOAuth` + `GoogleProfile` types)
- Create: `apps/server/src/google-oauth.ts` + `.test.ts`
- Modify: `apps/server/src/index.ts` (`buildGoogleOAuth()` → `AgentServices.googleOAuth`)
- Modify: `packages/api/src/services.ts` (`AgentServices.googleOAuth: GoogleOAuth | null`)
- Modify: `packages/api/src/routers/auth.ts` (`googleAuthUrl`, `googleSignIn`)
- Modify: `packages/agent/src/testing/fake-auth-stores.ts` (or wherever fakes live) + `auth.test.ts`

- [ ] **Step 1: ports**

```ts
export interface GoogleProfile {
	email: string;
	emailVerified: boolean;
}
export interface GoogleOAuth {
	/** The Google consent URL to redirect the user to. */
	authUrl(state: string): string;
	/** Exchange the authorization code for the user's verified email. */
	exchangeCode(code: string): Promise<GoogleProfile>;
}
```

- [ ] **Step 2: `google-oauth.ts` (apps/server)**

```ts
import type { GoogleOAuth } from "@better-agent/agent/ports";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

export function createGoogleOAuth(config: {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
}): GoogleOAuth {
	return {
		authUrl(state) {
			const params = new URLSearchParams({
				client_id: config.clientId,
				redirect_uri: config.redirectUri,
				response_type: "code",
				scope: "openid email",
				state,
				access_type: "online",
				prompt: "select_account",
			});
			return `${AUTH_ENDPOINT}?${params.toString()}`;
		},
		async exchangeCode(code) {
			const tokenRes = await fetch(TOKEN_ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					code,
					client_id: config.clientId,
					client_secret: config.clientSecret,
					redirect_uri: config.redirectUri,
					grant_type: "authorization_code",
				}),
			});
			if (!tokenRes.ok) {
				throw new Error("Google token exchange failed");
			}
			const token = (await tokenRes.json()) as { access_token: string };
			const infoRes = await fetch(USERINFO_ENDPOINT, {
				headers: { authorization: `Bearer ${token.access_token}` },
			});
			if (!infoRes.ok) {
				throw new Error("Google userinfo request failed");
			}
			const info = (await infoRes.json()) as {
				email: string;
				email_verified: boolean;
			};
			return { email: info.email, emailVerified: info.email_verified === true };
		},
	};
}
```
Test (`google-oauth.test.ts`): `authUrl(state)` contains the client_id, the redirect_uri, `response_type=code`, `state`, and `scope`. (Optionally test `exchangeCode` by stubbing global `fetch` with a mock returning a token then a userinfo body → `{email, emailVerified}`; if stubbing fetch is awkward, the authUrl test + the router-level fake cover the logic.)

- [ ] **Step 3: env + wiring**

`packages/env/src/server.ts`: `GOOGLE_CLIENT_ID: z.string().optional(),` `GOOGLE_CLIENT_SECRET: z.string().optional(),`.
`apps/server/src/index.ts`: 
```ts
function buildGoogleOAuth() {
	if (!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)) {
		return null;
	}
	return createGoogleOAuth({
		clientId: env.GOOGLE_CLIENT_ID,
		clientSecret: env.GOOGLE_CLIENT_SECRET,
		redirectUri: `${env.WEB_URL}/auth/google/callback`,
	});
}
```
Add `googleOAuth: buildGoogleOAuth(),` to the services object.
`packages/api/src/services.ts`: `AgentServices` += `googleOAuth: GoogleOAuth | null;` (import the type).

- [ ] **Step 4: endpoints (`auth.ts`)**

```ts
	googleAuthUrl: publicProcedure
		.input(z.object({ state: z.string().min(1) }))
		.handler(({ input, context }) => {
			const google = context.services.googleOAuth;
			if (!google) {
				throw new ORPCError("NOT_FOUND", { message: "Google sign-in is not configured" });
			}
			return { url: google.authUrl(input.state) };
		}),

	googleSignIn: publicProcedure
		.input(z.object({ code: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const google = context.services.googleOAuth;
			if (!google) {
				throw new ORPCError("NOT_FOUND", { message: "Google sign-in is not configured" });
			}
			await enforce(context.services.rateLimiter, `google:ip:${context.clientIp}`, 30);
			const profile = await google.exchangeCode(input.code);
			if (!profile.emailVerified) {
				throw new ORPCError("UNAUTHORIZED", { message: "Your Google email is not verified" });
			}
			const user = await context.services.stores.user.findOrCreate(profile.email);
			await context.services.stores.user.markEmailVerified(user.id);
			return issueTokens(context, user);
		}),
```
(`30` → a named const `LIMIT_GOOGLE_IP`.)

- [ ] **Step 5: tests**

- `google-oauth.test.ts` (authUrl).
- auth router (with a FAKE `googleOAuth` in the test services): `googleSignIn` with a fake that returns a verified profile → issues tokens, user created, email marked verified; with `emailVerified:false` → UNAUTHORIZED; with `googleOAuth: null` → both procedures throw NOT_FOUND. `googleAuthUrl` returns `{ url }` containing the state.
- Update fixtures: add `googleOAuth: null` (or a fake) to existing test `services` objects so they still typecheck.

- [ ] **Step 6: verify + commit**

```bash
pnpm check-types
pnpm -F server test
pnpm -F @better-agent/api test
pnpm exec biome lint <changed files>
git add -A ':!docs/research'
git commit -m "$(printf 'feat(api): google oauth sign-in\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: root tsc clean; server + api tests pass; lint clean.

---

### Task 2: Web — Google button + callback

**Files:**
- Modify: `apps/web/src/routes/login.tsx` (Continue with Google button)
- Create: `apps/web/src/routes/auth.google.callback.tsx`
- Modify: `apps/web/src/components/auth-guard.tsx` (PUBLIC_PATHS)

- [ ] **Step 1: login button**

Add a "Continue with Google" `Button` (variant outline, full width) below the password form (visible in signin + create modes). onClick:
```ts
const state = crypto.randomUUID();
sessionStorage.setItem("google_oauth_state", state);
const { url } = await client.auth.googleAuthUrl({ state });
window.location.href = url;
```
(Use the raw `client` from `@/utils/orpc`, not a query.) On error (e.g. not configured) → `toast.error(error.message)`. Extract a small handler/subcomponent to keep functions ≤50.

- [ ] **Step 2: callback route**

NEW `apps/web/src/routes/auth.google.callback.tsx` → path `/auth/google/callback`. `validateSearch` reads `code` + `state` (strings, default ""). In a `useEffect` (run once): if no code/state, or `sessionStorage.getItem("google_oauth_state") !== state` → set an error state; else `client.auth.googleSignIn({ code })` → `setTokens(result)` → `sessionStorage.removeItem("google_oauth_state")` → `navigate({ to: "/" })`; on throw → error state. Render "Signing you in…" while pending and an error + "Back to sign in" link on failure. Mirror `auth.verify.tsx`'s structure (it does the same once-effect + cancellation guard pattern).

- [ ] **Step 3: PUBLIC_PATHS**

Add `/auth/google/callback` to `PUBLIC_PATHS` in `apps/web/src/components/auth-guard.tsx`.

- [ ] **Step 4: verify + commit**

```bash
pnpm -F web build
cd apps/web && pnpm exec tsc --noEmit && cd ../..
pnpm exec biome lint apps/web/src/routes/login.tsx apps/web/src/routes/auth.google.callback.tsx apps/web/src/components/auth-guard.tsx
git add apps/web/src/routes/login.tsx apps/web/src/routes/auth.google.callback.tsx apps/web/src/components/auth-guard.tsx
git commit -m "$(printf 'feat(web): continue-with-google sign-in\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: web build + tsc clean, lint clean.

---

## Self-Review Notes
- Coverage: GoogleOAuth service (authUrl + code exchange via token+userinfo), env + graceful-disable, googleAuthUrl/googleSignIn (verified-email gate, rate-limited, link by email, mark verified, issue tokens), web button + callback (state CSRF check).
- Type consistency: `GoogleProfile {email, emailVerified}` from `exchangeCode`; `AgentServices.googleOAuth: GoogleOAuth | null` consumed by the procedures. `googleAuthUrl` returns `{ url }`.
- Security: secret server-only; redirect_uri server-derived; state CSRF; verified-email required; rate-limited; account-link by verified email.
- Setup note (for the human): create a Google OAuth client, add `${WEB_URL}/auth/google/callback` as an authorized redirect URI, set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Until then the button returns "not configured".
- YAGNI: Google only; no oauth_accounts table (link by verified email); userinfo endpoint (no JWKS verify — token came directly from Google over TLS); no refresh of Google tokens (online access).
