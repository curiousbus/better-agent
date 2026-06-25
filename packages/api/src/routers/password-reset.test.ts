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
		googleOAuth: null,
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
	return { client, email, passwordReset, refreshToken, services };
}

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
