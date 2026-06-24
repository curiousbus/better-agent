import { createJwtService } from "@better-agent/agent/crypto/jwt";
import {
	createFakeEmailSender,
	createFakeMagicLinkStore,
	createFakeRefreshTokenStore,
	createFakeUserStore,
} from "@better-agent/agent/testing/fake-auth-stores";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

function build() {
	const jwtService = createJwtService("a-test-secret-at-least-32-chars-long!!");
	const email = createFakeEmailSender();
	const services = {
		jwtService,
		emailSender: email,
		authConfig: {
			webUrl: "http://web.test",
			accessTtl: 900,
			refreshTtl: 2_592_000,
			magicLinkTtl: 900,
		},
		stores: {
			user: createFakeUserStore(),
			magicLink: createFakeMagicLinkStore(),
			refreshToken: createFakeRefreshTokenStore(),
		},
	};
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: null,
		},
	});
	return { client, email };
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
});
