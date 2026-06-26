import { SUPER_ADMIN_EMAIL } from "@better-agent/agent/auth/admin";
import { createFakeUserStore } from "@better-agent/agent/testing/fake-auth-stores";
import type {
	ComposioConnectionMeta,
	ComposioService,
} from "@better-agent/agent/tool/composio-tools";
import { createRouterClient } from "@orpc/server";
import { expect, it, vi } from "vitest";
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
	connect: () => Promise.resolve({ redirectUrl: "" }),
	listConnections: () => Promise.resolve([]),
	disconnect: () => Promise.resolve(),
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
		connect: () => Promise.resolve({ redirectUrl: "" }),
		listConnections: () => Promise.resolve([]),
		disconnect: () => Promise.resolve(),
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

const PLAIN_USER = {
	id: "plain-user-uid",
	email: "user@example.com",
	createdAt: new Date(),
};

function buildUserClient(composio: ComposioService | null) {
	const user = createFakeUserStore();
	const services = { authConfig: AUTH_CONFIG, composio, stores: { user } };
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: PLAIN_USER,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	return { client };
}

it("connect returns the redirect URL from the service", async () => {
	const svc: ComposioService = {
		...fakeComposio,
		connect: () => Promise.resolve({ redirectUrl: "https://x" }),
	};
	const { client } = buildUserClient(svc);
	expect(await client.composio.connect({ toolkit: "gmail" })).toEqual({
		redirectUrl: "https://x",
	});
});

it("connections returns the listConnections result", async () => {
	const conn: ComposioConnectionMeta = {
		id: "ca_1",
		toolkitSlug: "gmail",
		status: "ACTIVE",
		active: true,
	};
	const svc: ComposioService = {
		...fakeComposio,
		listConnections: () => Promise.resolve([conn]),
	};
	const { client } = buildUserClient(svc);
	expect(await client.composio.connections()).toEqual([conn]);
});

it("disconnect calls svc.disconnect and returns ok when the id belongs to the caller", async () => {
	const disconnectSpy = vi.fn(() => Promise.resolve());
	const svc: ComposioService = {
		...fakeComposio,
		listConnections: () =>
			Promise.resolve([
				{ id: "ca_1", toolkitSlug: "gmail", status: "ACTIVE", active: true },
			]),
		disconnect: disconnectSpy,
	};
	const { client } = buildUserClient(svc);
	expect(await client.composio.disconnect({ id: "ca_1" })).toEqual({
		ok: true,
	});
	expect(disconnectSpy).toHaveBeenCalledWith("ca_1");
});

it("disconnect rejects NOT_FOUND and does not call svc.disconnect when id is not owned", async () => {
	const disconnectSpy = vi.fn(() => Promise.resolve());
	const svc: ComposioService = {
		...fakeComposio,
		listConnections: () => Promise.resolve([]),
		disconnect: disconnectSpy,
	};
	const { client } = buildUserClient(svc);
	await expect(
		client.composio.disconnect({ id: "not-mine" })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	expect(disconnectSpy).not.toHaveBeenCalled();
});

it("connectableToolkits returns configured:false and empty list when composio is null", async () => {
	const { client } = buildUserClient(null);
	expect(await client.composio.connectableToolkits()).toEqual({
		configured: false,
		toolkits: [],
	});
});

it("connections returns [] when composio is null", async () => {
	const { client } = buildUserClient(null);
	expect(await client.composio.connections()).toEqual([]);
});

it("connect rejects NOT_FOUND when composio is null", async () => {
	const { client } = buildUserClient(null);
	await expect(
		client.composio.connect({ toolkit: "gmail" })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("connectableToolkits filters to needsAuth:true toolkits only", async () => {
	const svc: ComposioService = {
		...fakeComposio,
		listToolkits: () =>
			Promise.resolve([
				{ slug: "github", name: "GitHub", description: "d", needsAuth: true },
				{ slug: "hn", name: "HackerNews", description: "d", needsAuth: false },
			]),
	};
	const { client } = buildUserClient(svc);
	const result = await client.composio.connectableToolkits();
	expect(result).toEqual({
		configured: true,
		toolkits: [
			{ slug: "github", name: "GitHub", description: "d", needsAuth: true },
		],
	});
});
