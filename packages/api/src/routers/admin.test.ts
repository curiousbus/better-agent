import { SUPER_ADMIN_EMAIL } from "@better-agent/agent/auth/admin";
import {
	createFakeRefreshTokenStore,
	createFakeUserStore,
} from "@better-agent/agent/testing/fake-auth-stores";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const ONE_MINUTE_MS = 60_000;

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
			stores: { user, refreshToken },
		},
		user,
		refreshToken,
	};
}

function buildAdminClient(authedUser = SUPER_ADMIN_USER) {
	const { services, user, refreshToken } = buildServices();
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	return { client, user, refreshToken };
}

function buildUnauthClient() {
	const { services } = buildServices();
	return createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: null,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
}

it("listUsers returns all users with correct shape", async () => {
	const { client, user } = buildAdminClient();
	const alice = await user.findOrCreate("alice@example.com");
	await user.markEmailVerified(alice.id);
	await user.setPasswordHash(alice.id, "hash");
	const rows = await client.admin.listUsers();
	expect(rows.length).toBeGreaterThanOrEqual(1);
	const row = rows.find((r) => r.email === "alice@example.com");
	expect(row).toMatchObject({
		email: "alice@example.com",
		emailVerified: true,
		hasPassword: true,
		isAdmin: false,
	});
});

it("setUserAdmin grants admin so the user then passes adminProcedure via DB flag", async () => {
	const { services, user } = buildServices();

	// Create a DB-only admin (NOT in the env allowlist)
	const dbAdmin = await user.findOrCreate("dbadmin@example.com");

	// Promote them via the super-admin client
	const superClient = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: SUPER_ADMIN_USER,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	await superClient.admin.setUserAdmin({ userId: dbAdmin.id, isAdmin: true });

	// Now build a client authed as the newly-promoted DB admin
	const dbAdminClient = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: {
				id: dbAdmin.id,
				email: dbAdmin.email,
				createdAt: dbAdmin.createdAt,
			},
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});

	// listUsers is admin-gated — this should succeed now
	const rows = await dbAdminClient.admin.listUsers();
	expect(Array.isArray(rows)).toBe(true);
});

it("demoting the super admin returns BAD_REQUEST", async () => {
	const { client, user } = buildAdminClient();
	const superAdmin = await user.findOrCreate(SUPER_ADMIN_EMAIL);
	await expect(
		client.admin.setUserAdmin({ userId: superAdmin.id, isAdmin: false })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("setUserAdmin returns NOT_FOUND for unknown userId", async () => {
	const { client } = buildAdminClient();
	await expect(
		client.admin.setUserAdmin({
			userId: "00000000-0000-0000-0000-000000000000",
			isAdmin: true,
		})
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("deleteUser removes the user and revokes their refresh tokens", async () => {
	const { client, user, refreshToken } = buildAdminClient();
	const victim = await user.findOrCreate("victim@example.com");
	await refreshToken.create({
		userId: victim.id,
		tokenHash: "hash-abc",
		expiresAt: new Date(Date.now() + ONE_MINUTE_MS),
	});

	await client.admin.deleteUser({ userId: victim.id });

	expect(await user.findById(victim.id)).toBeNull();
	const active = await refreshToken.listActiveByUser(victim.id);
	expect(active).toHaveLength(0);
});

it("deleteUser returns NOT_FOUND for unknown userId", async () => {
	const { client } = buildAdminClient();
	await expect(
		client.admin.deleteUser({ userId: "00000000-0000-0000-0000-000000000000" })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("deleteUser returns BAD_REQUEST when deleting the super admin", async () => {
	const { client, user } = buildAdminClient();
	const superAdmin = await user.findOrCreate(SUPER_ADMIN_EMAIL);
	await expect(
		client.admin.deleteUser({ userId: superAdmin.id })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("deleteUser returns BAD_REQUEST when deleting yourself", async () => {
	const { services, user } = buildServices();
	// Use a non-super-admin DB admin so the super-admin guard doesn't fire first
	const caller = await user.findOrCreate("selfdelete@example.com");
	await user.setAdmin(caller.id, true);
	const selfClient = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: {
				id: caller.id,
				email: caller.email,
				createdAt: caller.createdAt,
			},
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	await expect(
		selfClient.admin.deleteUser({ userId: caller.id })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("non-admin caller is FORBIDDEN on all admin procedures", async () => {
	const { services, user } = buildServices();
	const regular = await user.findOrCreate("regular@example.com");
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
	await expect(client.admin.listUsers()).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	await expect(
		client.admin.setUserAdmin({ userId: regular.id, isAdmin: true })
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	await expect(
		client.admin.deleteUser({ userId: "00000000-0000-0000-0000-000000000000" })
	).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("unauthenticated caller is UNAUTHORIZED on admin procedures", async () => {
	const client = buildUnauthClient();
	await expect(client.admin.listUsers()).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
});
