import type { ComposioAccountRow } from "@better-agent/agent/ports";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const ALICE = {
	id: "a-uid",
	email: "alice@x.com",
	createdAt: new Date(),
	blocked: false,
};
const BOB = {
	id: "b-uid",
	email: "bob@x.com",
	createdAt: new Date(),
	blocked: false,
};

function memoryAccountStore() {
	const rows: ComposioAccountRow[] = [];
	return {
		rows,
		list: () => Promise.resolve(rows),
		listByUser: (userId: string) =>
			Promise.resolve(rows.filter((row) => row.userId === userId)),
		getById: (id: string) =>
			Promise.resolve(rows.find((row) => row.id === id) ?? null),
		create: (input: { name: string; apiKey: string; userId?: string }) => {
			const row: ComposioAccountRow = {
				id: crypto.randomUUID(),
				name: input.name,
				apiKeyLast4: input.apiKey.slice(-4),
				userId: input.userId ?? null,
				createdAt: new Date(),
			};
			rows.push(row);
			return Promise.resolve(row);
		},
		delete: (id: string) => {
			const idx = rows.findIndex((row) => row.id === id);
			if (idx >= 0) {
				rows.splice(idx, 1);
			}
			return Promise.resolve();
		},
	};
}

function build() {
	const accountStore = memoryAccountStore();
	const services = {
		authz: { enabled: false },
		// A permissive fake composio service: key validation and toolkit calls succeed.
		composio: () =>
			Promise.resolve({
				listConnections: () => Promise.resolve([]),
				listToolkits: () => Promise.resolve([]),
				connect: () => Promise.resolve({ redirectUrl: "https://x" }),
				disconnect: () => Promise.resolve(),
			}),
		stores: {
			activity: { log: () => Promise.resolve() },
			composioAccount: accountStore,
		},
	};
	const clientFor = (user: typeof ALICE) =>
		createRouterClient(appRouter, {
			context: {
				services: services as never,
				authedAgent: null,
				authedUser: user,
				clientIp: "127.0.0.1",
				userAgent: null,
			},
		});
	return { accountStore, clientFor };
}

it("accounts are scoped to their owner; foreign access is NOT_FOUND", async () => {
	const { clientFor } = build();
	const alice = clientFor(ALICE);
	const bob = clientFor(BOB);

	const account = await alice.composio.createAccount({
		name: "Mine",
		apiKey: "ck_1234",
	});
	expect(account.userId).toBe(ALICE.id);
	expect((await alice.composio.listAccounts()).map((a) => a.id)).toContain(
		account.id
	);
	expect(await bob.composio.listAccounts()).toHaveLength(0);

	await expect(
		bob.composio.toolkits({ accountId: account.id })
	).rejects.toThrow();
	await expect(
		bob.composio.connections({ accountId: account.id })
	).rejects.toThrow();
	await expect(
		bob.composio.deleteAccount({ accountId: account.id })
	).rejects.toThrow();

	await alice.composio.deleteAccount({ accountId: account.id });
	expect(await alice.composio.listAccounts()).toHaveLength(0);
});
