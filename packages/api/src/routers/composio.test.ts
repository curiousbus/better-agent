import { createFakeUserStore } from "@better-agent/agent/testing/fake-auth-stores";
import { createFakeSettingsStore } from "@better-agent/agent/testing/fakes";
import type {
	ComposioConnectionMeta,
	ComposioService,
} from "@better-agent/agent/tool/composio-tools";
import { composioKeyName } from "@better-agent/agent/tool/composio-tools";
import { createRouterClient } from "@orpc/server";
import { expect, it, vi } from "vitest";
import { appRouter } from "./index";

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

const PLAIN_USER = {
	id: "plain-user-uid",
	email: "user@example.com",
	createdAt: new Date(),
};

function buildUserClient(composio: ComposioService | null) {
	const user = createFakeUserStore();
	const settings = createFakeSettingsStore();
	const services = {
		authConfig: AUTH_CONFIG,
		composio: (_userId: string) => Promise.resolve(composio),
		stores: { user, settings },
	};
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: PLAIN_USER,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	return { client, settings };
}

it("keyStatus returns configured:false when no key is set", async () => {
	const { client } = buildUserClient(null);
	expect(await client.composio.keyStatus()).toEqual({ configured: false });
});

it("setKey then keyStatus returns configured:true", async () => {
	const { client } = buildUserClient(null);
	await client.composio.setKey({ apiKey: "sk-test" });
	expect(await client.composio.keyStatus()).toEqual({ configured: true });
});

it("clearKey after setKey returns configured:false", async () => {
	const { client } = buildUserClient(null);
	await client.composio.setKey({ apiKey: "sk-test" });
	await client.composio.clearKey();
	expect(await client.composio.keyStatus()).toEqual({ configured: false });
});

it("keyStatus never leaks the key value", async () => {
	const { client } = buildUserClient(null);
	await client.composio.setKey({ apiKey: "sk-secret" });
	const status = await client.composio.keyStatus();
	expect(JSON.stringify(status)).not.toContain("sk-secret");
});

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

it("setKey stores the key under composioKeyName for the caller", async () => {
	const { client, settings } = buildUserClient(null);
	await client.composio.setKey({ apiKey: "sk-xyz" });
	const stored = await settings.get(composioKeyName(PLAIN_USER.id));
	expect(stored).toBe("sk-xyz");
});
