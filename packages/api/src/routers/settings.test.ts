import { SUPER_ADMIN_EMAIL } from "@better-agent/agent/auth/admin";
import { createFakeUserStore } from "@better-agent/agent/testing/fake-auth-stores";
import { createFakeSettingsStore } from "@better-agent/agent/testing/fakes";
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

function buildClient(
	envSecretKeys: string[],
	authedUser: typeof SUPER_ADMIN_USER | null = SUPER_ADMIN_USER
) {
	const user = createFakeUserStore();
	const settings = createFakeSettingsStore();
	const services = {
		authConfig: AUTH_CONFIG,
		envSecretKeys,
		stores: { user, settings },
	};
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	return { client, settings };
}

it("list returns source:none and configured:false when key is not in db or env", async () => {
	const { client } = buildClient([]);
	const result = await client.settings.list();
	expect(result).toHaveLength(1);
	const entry = result[0];
	expect(entry).toMatchObject({
		key: "COMPOSIO_API_KEY",
		configured: false,
		source: "none",
	});
	expect(entry).not.toHaveProperty("value");
});

it("list returns source:env and configured:true when key is in envSecretKeys", async () => {
	const { client } = buildClient(["COMPOSIO_API_KEY"]);
	const result = await client.settings.list();
	const entry = result[0];
	expect(entry).toMatchObject({
		key: "COMPOSIO_API_KEY",
		configured: true,
		source: "env",
	});
	expect(entry).not.toHaveProperty("value");
});

it("list returns source:db after set, and never includes the value", async () => {
	const { client } = buildClient([]);
	await client.settings.set({ key: "COMPOSIO_API_KEY", value: "sk-x" });
	const result = await client.settings.list();
	const entry = result[0];
	expect(entry).toMatchObject({
		key: "COMPOSIO_API_KEY",
		configured: true,
		source: "db",
	});
	expect(entry).not.toHaveProperty("value");
});

it("list returns source:env after clear when envSecretKeys has the key", async () => {
	const { client } = buildClient(["COMPOSIO_API_KEY"]);
	await client.settings.set({ key: "COMPOSIO_API_KEY", value: "sk-x" });
	await client.settings.clear({ key: "COMPOSIO_API_KEY" });
	const result = await client.settings.list();
	expect(result[0]).toMatchObject({ source: "env", configured: true });
});

it("list returns source:none after clear when envSecretKeys is empty", async () => {
	const { client } = buildClient([]);
	await client.settings.set({ key: "COMPOSIO_API_KEY", value: "sk-x" });
	await client.settings.clear({ key: "COMPOSIO_API_KEY" });
	const result = await client.settings.list();
	expect(result[0]).toMatchObject({ source: "none", configured: false });
});

it("list is FORBIDDEN for a non-admin caller", async () => {
	const { client } = buildClient([], {
		id: "plain-user-uid",
		email: "user@example.com",
		createdAt: new Date(),
	});
	await expect(client.settings.list()).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
});

it("set is FORBIDDEN for a non-admin caller", async () => {
	const { client } = buildClient([], {
		id: "plain-user-uid",
		email: "user@example.com",
		createdAt: new Date(),
	});
	await expect(
		client.settings.set({ key: "COMPOSIO_API_KEY", value: "sk-x" })
	).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("clear is FORBIDDEN for a non-admin caller", async () => {
	const { client } = buildClient([], {
		id: "plain-user-uid",
		email: "user@example.com",
		createdAt: new Date(),
	});
	await expect(
		client.settings.clear({ key: "COMPOSIO_API_KEY" })
	).rejects.toMatchObject({ code: "FORBIDDEN" });
});
