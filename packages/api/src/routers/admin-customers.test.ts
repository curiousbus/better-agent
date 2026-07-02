import { SUPER_ADMIN_EMAIL } from "@better-agent/agent/auth/admin";
import { createFakeUserStore } from "@better-agent/agent/testing/fake-user-store";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const SUSPENDED_RE = /suspended/;
const NOT_FOUND_RE = /not found/i;

const ADMIN = {
	id: "admin-1",
	email: SUPER_ADMIN_EMAIL,
	createdAt: new Date(),
	blocked: false,
};

function build() {
	const userStore = createFakeUserStore();
	const revoked: string[] = [];
	const services = {
		authz: { enabled: false },
		authConfig: {
			webUrl: "http://web.test",
			adminUrl: "http://admin.test",
			accessTtl: 900,
			refreshTtl: 2_592_000,
			magicLinkTtl: 900,
			adminEmails: [] as string[],
		},
		stores: {
			user: userStore,
			activity: { log: () => Promise.resolve() },
			agent: { listByUser: () => Promise.resolve([]) },
			refreshToken: {
				revokeAllForUser: (userId: string) => {
					revoked.push(userId);
					return Promise.resolve();
				},
			},
		},
	};
	const clientFor = (user: typeof ADMIN) =>
		createRouterClient(appRouter, {
			context: {
				services: services as never,
				authedAgent: null,
				authedUser: user,
				clientIp: "127.0.0.1",
				userAgent: null,
			},
		});
	return { userStore, revoked, clientFor };
}

it("blockUser flags the customer, revokes refresh tokens; unblock reinstates", async () => {
	const { userStore, revoked, clientFor } = build();
	const customer = await userStore.findOrCreate("c@x.com");
	const admin = clientFor(ADMIN);

	await admin.admin.blockUser({ userId: customer.id });
	expect(revoked).toEqual([customer.id]);
	expect((await userStore.findById(customer.id))?.blocked).toBe(true);
	const listed = await admin.admin.listCustomers();
	expect(listed.find((c) => c.id === customer.id)?.blocked).toBe(true);

	await admin.admin.unblockUser({ userId: customer.id });
	expect((await userStore.findById(customer.id))?.blocked).toBe(false);
});

it("a blocked user is rejected on any authed procedure (immediate cutoff)", async () => {
	const { userStore, clientFor } = build();
	const customer = await userStore.findOrCreate("blocked@x.com");
	await userStore.setBlocked(customer.id, true);
	const blockedUser = {
		id: customer.id,
		email: customer.email,
		createdAt: customer.createdAt,
		blocked: true,
	};
	const api = clientFor(blockedUser);
	await expect(api.auth.me()).rejects.toThrow(SUSPENDED_RE);
	await expect(api.agents.list()).rejects.toThrow(SUSPENDED_RE);
});

it("staff cannot be managed via customer endpoints (NOT_FOUND)", async () => {
	const { userStore, clientFor } = build();
	const staff = await userStore.createWithPassword("s@x.com", "hash", "staff");
	const admin = clientFor(ADMIN);
	await expect(admin.admin.blockUser({ userId: staff.id })).rejects.toThrow(
		NOT_FOUND_RE
	);
});
