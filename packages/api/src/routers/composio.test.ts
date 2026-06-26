import { SUPER_ADMIN_EMAIL } from "@better-agent/agent/auth/admin";
import { createFakeUserStore } from "@better-agent/agent/testing/fake-auth-stores";
import type { ComposioService } from "@better-agent/agent/tool/composio-tools";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const SUPER_ADMIN_USER = {
	id: "super-admin-uid",
	email: SUPER_ADMIN_EMAIL,
	createdAt: new Date(),
};

const AUTH_CONFIG = {
	webUrl: "http://web.test",
	adminUrl: "http://admin.test",
	accessTtl: 900,
	refreshTtl: 2_592_000,
	magicLinkTtl: 900,
	adminEmails: [] as string[],
};

const fakeComposio: ComposioService = {
	listToolkits: () =>
		Promise.resolve([
			{ slug: "github", name: "GitHub", description: "d", needsAuth: true },
		]),
	listTools: () => Promise.resolve([]),
	execute: () => Promise.resolve({ output: "" }),
};

function buildClient(
	composio: ComposioService | null,
	authedUser: typeof SUPER_ADMIN_USER | null = SUPER_ADMIN_USER
) {
	const user = createFakeUserStore();
	const services = { authConfig: AUTH_CONFIG, composio, stores: { user } };
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	return { client, user };
}

it("listToolkits returns the catalog for an admin when composio is configured", async () => {
	const { client } = buildClient(fakeComposio);
	const result = await client.composio.listToolkits();
	expect(result).toEqual({
		configured: true,
		toolkits: [
			{ slug: "github", name: "GitHub", description: "d", needsAuth: true },
		],
	});
});

it("listToolkits reports not-configured when composio is null", async () => {
	const { client } = buildClient(null);
	expect(await client.composio.listToolkits()).toEqual({
		configured: false,
		toolkits: [],
	});
});

it("listToolkits degrades to an empty catalog when the upstream call fails", async () => {
	const boom: ComposioService = {
		listToolkits: () => Promise.reject(new Error("composio down")),
		listTools: () => Promise.resolve([]),
		execute: () => Promise.resolve({ output: "" }),
	};
	const { client } = buildClient(boom);
	expect(await client.composio.listToolkits()).toEqual({
		configured: true,
		toolkits: [],
	});
});

it("listToolkits is FORBIDDEN for a non-admin caller", async () => {
	const user = createFakeUserStore();
	const regular = await user.findOrCreate("regular@example.com");
	const services = {
		authConfig: AUTH_CONFIG,
		composio: fakeComposio,
		stores: { user },
	};
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: {
				id: regular.id,
				email: regular.email,
				createdAt: regular.createdAt,
			},
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	await expect(client.composio.listToolkits()).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
});
