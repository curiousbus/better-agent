import { createInMemoryRateLimiter } from "@better-agent/agent/auth/rate-limiter";
import { createJwtService } from "@better-agent/agent/crypto/jwt";
import type { GoogleOAuth, GoogleProfile } from "@better-agent/agent/ports";
import {
	createFakeMagicLinkStore,
	createFakePasswordResetStore,
	createFakeRefreshTokenStore,
	createFakeUserStore,
} from "@better-agent/agent/testing/fake-auth-stores";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

function createFakeGoogleOAuth(profile: GoogleProfile): GoogleOAuth {
	return {
		authUrl(state) {
			return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&client_id=fake-client-id`;
		},
		exchangeCode(_code) {
			return Promise.resolve(profile);
		},
	};
}

function build(googleOAuth: GoogleOAuth | null = null) {
	const jwtService = createJwtService("a-test-secret-at-least-32-chars-long!!");
	const passwordReset = createFakePasswordResetStore();
	const refreshToken = createFakeRefreshTokenStore();
	const services = {
		jwtService,
		googleOAuth,
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
			activity: { log: () => Promise.resolve() },
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
	return { client, services };
}

it("googleAuthUrl returns a url containing the state when configured", async () => {
	const { client } = build(
		createFakeGoogleOAuth({ email: "g@test.com", emailVerified: true })
	);
	const result = await client.auth.googleAuthUrl({ state: "csrf-state-123" });
	expect(result.url).toContain("csrf-state-123");
});

it("googleAuthUrl returns NOT_FOUND when googleOAuth is null", async () => {
	const { client } = build(null);
	await expect(
		client.auth.googleAuthUrl({ state: "some-state" })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("googleSignIn issues tokens and creates user when email is verified", async () => {
	const { client, services } = build(
		createFakeGoogleOAuth({ email: "google@test.com", emailVerified: true })
	);
	const result = await client.auth.googleSignIn({ code: "auth-code" });
	expect(result.user.email).toBe("google@test.com");
	expect(result.accessToken.length).toBeGreaterThan(0);
	expect(result.refreshToken.startsWith("rt_")).toBe(true);
	const user = await services.stores.user.findByEmail("google@test.com");
	expect(user).not.toBeNull();
	const verified = await services.stores.user.isEmailVerified(user?.id ?? "");
	expect(verified).toBe(true);
});

it("googleSignIn returns UNAUTHORIZED when emailVerified is false", async () => {
	const { client } = build(
		createFakeGoogleOAuth({
			email: "unverified@test.com",
			emailVerified: false,
		})
	);
	await expect(
		client.auth.googleSignIn({ code: "auth-code" })
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("googleSignIn returns NOT_FOUND when googleOAuth is null", async () => {
	const { client } = build(null);
	await expect(
		client.auth.googleSignIn({ code: "auth-code" })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});
