import { SUPER_ADMIN_EMAIL } from "@better-agent/agent/auth/admin";
import { createFakeUserStore } from "@better-agent/agent/testing/fake-auth-stores";
import {
	createFakeCatalogStore,
	createFakeCredentialStore,
	createFakeModelStore,
} from "@better-agent/agent/testing/fakes";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const AUTH_CONFIG = {
	webUrl: "http://web.test",
	adminUrl: "http://admin.test",
	accessTtl: 900,
	refreshTtl: 2_592_000,
	magicLinkTtl: 900,
	adminEmails: [] as string[],
};

function buildClient(email: string | null) {
	const providerCatalog = createFakeCatalogStore();
	const modelCache = createFakeModelStore();
	const providerCredential = createFakeCredentialStore();
	const user = createFakeUserStore();
	const services = {
		authConfig: AUTH_CONFIG,
		stores: { providerCatalog, modelCache, providerCredential, user },
	};
	const authedUser = email
		? { id: "uid-1", email, createdAt: new Date() }
		: null;
	return createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
}

it("non-admin user is FORBIDDEN from an admin-gated procedure", async () => {
	const client = buildClient("regular@example.com");
	await expect(client.providers.catalogList()).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
});

it("unauthenticated caller is UNAUTHORIZED on an admin-gated procedure", async () => {
	const client = buildClient(null);
	await expect(client.providers.catalogList()).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
});

it("super admin passes the admin gate", async () => {
	const client = buildClient(SUPER_ADMIN_EMAIL);
	const result = await client.providers.catalogList();
	expect(Array.isArray(result)).toBe(true);
});

it("allowlisted email passes the admin gate", async () => {
	const providerCatalog = createFakeCatalogStore();
	const modelCache = createFakeModelStore();
	const providerCredential = createFakeCredentialStore();
	const user = createFakeUserStore();
	const services = {
		authConfig: { ...AUTH_CONFIG, adminEmails: ["ops@example.com"] },
		stores: { providerCatalog, modelCache, providerCredential, user },
	};
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: {
				id: "uid-2",
				email: "ops@example.com",
				createdAt: new Date(),
			},
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	const result = await client.providers.catalogList();
	expect(Array.isArray(result)).toBe(true);
});
