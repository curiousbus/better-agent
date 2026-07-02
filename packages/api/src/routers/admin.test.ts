import { SUPER_ADMIN_EMAIL } from "@better-agent/agent/auth/admin";
import {
	createFakeRefreshTokenStore,
	createFakeUserStore,
} from "@better-agent/agent/testing/fake-auth-stores";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const ONE_MINUTE_MS = 60_000;
const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";
const STAFF_PASSWORD = "password123";

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

function buildServices() {
	const user = createFakeUserStore();
	const refreshToken = createFakeRefreshTokenStore();
	return {
		services: {
			authConfig: AUTH_CONFIG,
			stores: {
				activity: { log: () => Promise.resolve() },
				user,
				refreshToken,
			},
		},
		user,
		refreshToken,
	};
}

function clientFor(
	services: unknown,
	authedUser: { id: string; email: string; createdAt: Date } | null
) {
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

function buildAdminClient(authedUser = SUPER_ADMIN_USER) {
	const { services, user, refreshToken } = buildServices();
	return {
		client: clientFor(services, authedUser),
		services,
		user,
		refreshToken,
	};
}

it("listStaff returns only staff users", async () => {
	const { client, user } = buildAdminClient();
	await user.createWithPassword("staff@example.com", "hash", "staff");
	await user.findOrCreate("customer@example.com"); // a customer — excluded
	const rows = await client.admin.listStaff();
	expect(rows.map((r) => r.email)).toContain("staff@example.com");
	expect(rows.map((r) => r.email)).not.toContain("customer@example.com");
	expect(rows.every((r) => r.kind === "staff")).toBe(true);
});

it("createStaff makes a staff user that then passes adminProcedure", async () => {
	const { client, services } = buildAdminClient();
	const created = await client.admin.createStaff({
		email: "newstaff@example.com",
		password: STAFF_PASSWORD,
	});
	const staffClient = clientFor(services, {
		id: created.id,
		email: created.email,
		createdAt: created.createdAt,
	});
	const rows = await staffClient.admin.listStaff();
	expect(Array.isArray(rows)).toBe(true);
});

it("createStaff returns CONFLICT for an existing email", async () => {
	const { client, user } = buildAdminClient();
	await user.findOrCreate("taken@example.com");
	await expect(
		client.admin.createStaff({
			email: "taken@example.com",
			password: STAFF_PASSWORD,
		})
	).rejects.toMatchObject({ code: "CONFLICT" });
});

it("deleteStaff removes the user and revokes their refresh tokens", async () => {
	const { client, user, refreshToken } = buildAdminClient();
	const victim = await user.createWithPassword(
		"victim@example.com",
		"h",
		"staff"
	);
	await refreshToken.create({
		userId: victim.id,
		tokenHash: "hash-abc",
		expiresAt: new Date(Date.now() + ONE_MINUTE_MS),
	});
	await client.admin.deleteStaff({ userId: victim.id });
	expect(await user.findById(victim.id)).toBeNull();
	expect(await refreshToken.listActiveByUser(victim.id)).toHaveLength(0);
});

it("deleteStaff returns NOT_FOUND for unknown userId", async () => {
	const { client } = buildAdminClient();
	await expect(
		client.admin.deleteStaff({ userId: UNKNOWN_ID })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("deleteStaff returns BAD_REQUEST when deleting the super admin", async () => {
	const { client, user } = buildAdminClient();
	const superAdmin = await user.findOrCreate(SUPER_ADMIN_EMAIL);
	await expect(
		client.admin.deleteStaff({ userId: superAdmin.id })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("deleteStaff returns BAD_REQUEST when deleting yourself", async () => {
	const { services, user } = buildServices();
	const caller = await user.createWithPassword(
		"self@example.com",
		"h",
		"staff"
	);
	const selfClient = clientFor(services, {
		id: caller.id,
		email: caller.email,
		createdAt: caller.createdAt,
	});
	await expect(
		selfClient.admin.deleteStaff({ userId: caller.id })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("non-admin caller is FORBIDDEN on admin procedures", async () => {
	const { services, user } = buildServices();
	const regular = await user.findOrCreate("regular@example.com");
	const client = clientFor(services, {
		id: regular.id,
		email: regular.email,
		createdAt: regular.createdAt,
	});
	await expect(client.admin.listStaff()).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	await expect(
		client.admin.createStaff({
			email: "x@example.com",
			password: STAFF_PASSWORD,
		})
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	await expect(
		client.admin.deleteStaff({ userId: UNKNOWN_ID })
	).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("unauthenticated caller is UNAUTHORIZED on admin procedures", async () => {
	const client = clientFor(buildServices().services, null);
	await expect(client.admin.listStaff()).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
});
