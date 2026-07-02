import { SUPER_ADMIN_EMAIL } from "@better-agent/agent/auth/admin";
import {
	createFakeRefreshTokenStore,
	createFakeUserStore,
} from "@better-agent/agent/testing/fake-auth-stores";
import { createFakeSessionStore } from "@better-agent/agent/testing/fakes";
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

function buildAdminClientWithSessions(authedUser = SUPER_ADMIN_USER) {
	const user = createFakeUserStore();
	const refreshToken = createFakeRefreshTokenStore();
	const session = createFakeSessionStore();
	const services = {
		authConfig: AUTH_CONFIG,
		stores: {
			activity: { log: () => Promise.resolve() },
			user,
			refreshToken,
			session,
		},
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
	return { client, user, session };
}

it("sessions.list returns only sessions for the requested agent", async () => {
	const { client, session } = buildAdminClientWithSessions();
	const agentA = "a1a1a1a1-0000-4000-8000-000000000001";
	const agentB = "b2b2b2b2-0000-4000-8000-000000000002";
	await session.create({ agentId: agentA });
	await session.create({ agentId: agentA });
	await session.create({ agentId: agentB });

	const rows = await client.sessions.list({ agentId: agentA });
	expect(rows).toHaveLength(2);
	for (const row of rows) {
		expect(row.agentId).toBe(agentA);
	}
});

it("sessions.list is FORBIDDEN for a non-admin caller", async () => {
	const { user, session } = buildAdminClientWithSessions();
	const refreshToken = createFakeRefreshTokenStore();
	const regular = await user.findOrCreate("regular@example.com");
	const services = {
		authConfig: AUTH_CONFIG,
		stores: { user, refreshToken, session },
	};
	const regularClient = createRouterClient(appRouter, {
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
	const agentId = "c3c3c3c3-0000-4000-8000-000000000003";
	await expect(regularClient.sessions.list({ agentId })).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
});

it("sessions.list is UNAUTHORIZED for an anonymous caller", async () => {
	const user = createFakeUserStore();
	const refreshToken = createFakeRefreshTokenStore();
	const session = createFakeSessionStore();
	const services = {
		authConfig: AUTH_CONFIG,
		stores: { user, refreshToken, session },
	};
	const anonClient = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: null,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	const agentId = "d4d4d4d4-0000-4000-8000-000000000004";
	await expect(anonClient.sessions.list({ agentId })).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
});
