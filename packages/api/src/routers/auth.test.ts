import { createInMemoryRateLimiter } from "@better-agent/agent/auth/rate-limiter";
import { createJwtService } from "@better-agent/agent/crypto/jwt";
import {
	createFakeEmailSender,
	createFakeMagicLinkStore,
	createFakePasswordResetStore,
	createFakeRefreshTokenStore,
	createFakeUserStore,
} from "@better-agent/agent/testing/fake-auth-stores";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

function build() {
	const jwtService = createJwtService("a-test-secret-at-least-32-chars-long!!");
	const email = createFakeEmailSender();
	const passwordReset = createFakePasswordResetStore();
	const refreshToken = createFakeRefreshTokenStore();
	const services = {
		jwtService,
		emailSender: email,
		rateLimiter: createInMemoryRateLimiter(),
		authConfig: {
			webUrl: "http://web.test",
			adminUrl: "http://admin.test",
			accessTtl: 900,
			refreshTtl: 2_592_000,
			magicLinkTtl: 900,
			adminEmails: [] as string[],
		},
		stores: {
			user: createFakeUserStore(),
			magicLink: createFakeMagicLinkStore(),
			refreshToken,
			passwordReset,
		},
	};
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: null,
			clientIp: "ip",
			userAgent: null,
		},
	});
	const authedClient = (userId: string, userEmail: string) =>
		createRouterClient(appRouter, {
			context: {
				services: services as never,
				authedAgent: null,
				authedUser: { id: userId, email: userEmail, createdAt: new Date() },
				clientIp: "ip",
				userAgent: null,
			},
		});
	return { client, email, passwordReset, refreshToken, services, authedClient };
}

it("requestLink emails a verify URL carrying a token", async () => {
	const { client, email } = build();
	await client.auth.requestLink({ email: "x@y.com" });
	expect(email.sent).toHaveLength(1);
	expect(email.sent[0]?.url).toContain("http://web.test/auth/verify?token=ml_");
});

it("verify consumes the link and issues a token pair", async () => {
	const { client, email } = build();
	await client.auth.requestLink({ email: "x@y.com" });
	const token = email.sent[0]?.url.split("token=")[1] ?? "";
	const result = await client.auth.verify({ token });
	expect(result.user.email).toBe("x@y.com");
	expect(result.accessToken.length).toBeGreaterThan(0);
	expect(result.refreshToken.startsWith("rt_")).toBe(true);
	await expect(client.auth.verify({ token })).rejects.toThrow();
});

it("requestLink rejects with TOO_MANY_REQUESTS after per-email limit", async () => {
	const { client } = build();
	const LIMIT_LINK_EMAIL = 5;
	for (let i = 0; i < LIMIT_LINK_EMAIL; i++) {
		await client.auth.requestLink({ email: "rate@test.com" });
	}
	await expect(
		client.auth.requestLink({ email: "rate@test.com" })
	).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
});

it("refresh rotates the token and rejects the reused old one", async () => {
	const { client, email } = build();
	await client.auth.requestLink({ email: "x@y.com" });
	const token = email.sent[0]?.url.split("token=")[1] ?? "";
	const first = await client.auth.verify({ token });
	const rotated = await client.auth.refresh({
		refreshToken: first.refreshToken,
	});
	expect(rotated.refreshToken).not.toBe(first.refreshToken);
	await expect(
		client.auth.refresh({ refreshToken: first.refreshToken })
	).rejects.toThrow();
	// The reuse attempt triggers revokeAllForUser, so the rotated token dies too.
	await expect(
		client.auth.refresh({ refreshToken: rotated.refreshToken })
	).rejects.toThrow();
});

it("requestLink with audience=admin sends URL using adminUrl", async () => {
	const { client, email } = build();
	await client.auth.requestLink({ email: "x@y.com", audience: "admin" });
	expect(email.sent[0]?.url).toContain(
		"http://admin.test/auth/verify?token=ml_"
	);
});

it("requestLink defaults to web audience", async () => {
	const { client, email } = build();
	await client.auth.requestLink({ email: "x@y.com" });
	expect(email.sent[0]?.url).toContain("http://web.test/auth/verify?token=ml_");
});

it("registerWithPassword creates an account and returns tokens", async () => {
	const { client } = build();
	const result = await client.auth.registerWithPassword({
		email: "new@test.com",
		password: "securepass1",
	});
	expect(result.user.email).toBe("new@test.com");
	expect(result.accessToken.length).toBeGreaterThan(0);
	expect(result.refreshToken.startsWith("rt_")).toBe(true);
});

it("registerWithPassword rejects duplicate email with CONFLICT", async () => {
	const { client } = build();
	await client.auth.registerWithPassword({
		email: "dup@test.com",
		password: "securepass1",
	});
	await expect(
		client.auth.registerWithPassword({
			email: "dup@test.com",
			password: "securepass1",
		})
	).rejects.toMatchObject({ code: "CONFLICT" });
});

it("loginWithPassword succeeds after registration with correct password", async () => {
	const { client } = build();
	await client.auth.registerWithPassword({
		email: "login@test.com",
		password: "mypassword9",
	});
	const result = await client.auth.loginWithPassword({
		email: "login@test.com",
		password: "mypassword9",
	});
	expect(result.user.email).toBe("login@test.com");
	expect(result.accessToken.length).toBeGreaterThan(0);
	expect(result.refreshToken.startsWith("rt_")).toBe(true);
});

it("loginWithPassword rejects wrong password with generic UNAUTHORIZED", async () => {
	const { client } = build();
	await client.auth.registerWithPassword({
		email: "wrongpw@test.com",
		password: "correctpass1",
	});
	await expect(
		client.auth.loginWithPassword({
			email: "wrongpw@test.com",
			password: "wrongpassword",
		})
	).rejects.toMatchObject({
		code: "UNAUTHORIZED",
		message: "Invalid email or password",
	});
});

it("loginWithPassword rejects unknown email with the same generic UNAUTHORIZED", async () => {
	const { client } = build();
	await expect(
		client.auth.loginWithPassword({
			email: "ghost@test.com",
			password: "doesntmatter",
		})
	).rejects.toMatchObject({
		code: "UNAUTHORIZED",
		message: "Invalid email or password",
	});
});

it("after magic-link verify, me.emailVerified is true", async () => {
	const { client, email, authedClient } = build();
	await client.auth.requestLink({ email: "v@test.com" });
	const token = email.sent[0]?.url.split("token=")[1] ?? "";
	const result = await client.auth.verify({ token });
	const me = await authedClient(result.user.id, result.user.email).auth.me();
	expect(me.emailVerified).toBe(true);
});

it("registerWithPassword user has emailVerified false; true after magic-link verify", async () => {
	const { client, email, authedClient } = build();
	const reg = await client.auth.registerWithPassword({
		email: "combo@test.com",
		password: "validpass1",
	});
	const meBefore = await authedClient(reg.user.id, reg.user.email).auth.me();
	expect(meBefore.emailVerified).toBe(false);
	await client.auth.requestLink({ email: "combo@test.com" });
	const token = email.sent[0]?.url.split("token=")[1] ?? "";
	await client.auth.verify({ token });
	const meAfter = await authedClient(reg.user.id, reg.user.email).auth.me();
	expect(meAfter.emailVerified).toBe(true);
});

it("loginWithPassword rejects with TOO_MANY_REQUESTS after per-email limit", async () => {
	const { client } = build();
	const LIMIT_PASSWORD_EMAIL = 10;
	// Register first so credential exists (counts as 1 hit toward per-email limit)
	await client.auth.registerWithPassword({
		email: "ratelimited@test.com",
		password: "validpass1",
	});
	// Exhaust the remaining per-email budget with wrong-password attempts
	for (let i = 1; i < LIMIT_PASSWORD_EMAIL; i++) {
		await client.auth
			.loginWithPassword({
				email: "ratelimited@test.com",
				password: "wrongpass1",
			})
			.catch(() => {
				/* swallow UNAUTHORIZED — we only care about the rate counter */
			});
	}
	await expect(
		client.auth.loginWithPassword({
			email: "ratelimited@test.com",
			password: "validpass1",
		})
	).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
});

// ─── Password Reset ───────────────────────────────────────────────────────────
type B = ReturnType<typeof build>;
const PW = "oldpassword1";

async function setupReset(b: B, addr: string): Promise<string> {
	await b.client.auth.registerWithPassword({ email: addr, password: PW });
	await b.client.auth.requestPasswordReset({ email: addr });
	return b.email.resetSent.at(-1)?.url.split("token=")[1] ?? "";
}

it("requestPasswordReset: ok:true always; email only sent for known user", async () => {
	const b = build();
	const token = await setupReset(b, "reset@test.com");
	expect(token.startsWith("pr_")).toBe(true);
	await b.client.auth.requestPasswordReset({ email: "x@ghost.com" });
	expect(b.email.resetSent).toHaveLength(1); // ghost sends nothing
});

it("resetPassword: new password works; old password rejected", async () => {
	const b = build();
	const token = await setupReset(b, "e2e@test.com");
	await b.client.auth.resetPassword({ token, password: "newpassword2" });
	const ok = await b.client.auth.loginWithPassword({
		email: "e2e@test.com",
		password: "newpassword2",
	});
	expect(ok.user.email).toBe("e2e@test.com");
	await expect(
		b.client.auth.loginWithPassword({ email: "e2e@test.com", password: PW })
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("resetPassword revokes all active refresh tokens", async () => {
	const b = build();
	const token = await setupReset(b, "revoke@test.com");
	const { refreshToken: rt, user } = await b.client.auth.loginWithPassword({
		email: "revoke@test.com",
		password: PW,
	});
	const rotated = await b.client.auth.refresh({ refreshToken: rt });
	await b.client.auth.resetPassword({ token, password: "newpassword2" });
	await expect(
		b.client.auth.refresh({ refreshToken: rotated.refreshToken })
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	expect(await b.refreshToken.listActiveByUser(user.id)).toHaveLength(0);
});

it("resetPassword rejects unknown and already-consumed tokens with BAD_REQUEST", async () => {
	const b = build();
	await expect(
		b.client.auth.resetPassword({ token: "pr_bogus", password: "newpassword2" })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	const token = await setupReset(b, "single@test.com");
	await b.client.auth.resetPassword({ token, password: "newpassword2" });
	await expect(
		b.client.auth.resetPassword({ token, password: "anothernewpw3" })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
