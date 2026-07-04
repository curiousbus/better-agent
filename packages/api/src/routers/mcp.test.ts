import type { McpServerRow } from "@better-agent/agent/ports";
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

function memoryServerStore() {
	const rows: McpServerRow[] = [];
	return {
		rows,
		listByUser: (userId: string) =>
			Promise.resolve(rows.filter((row) => row.userId === userId)),
		getById: (id: string) =>
			Promise.resolve(rows.find((row) => row.id === id) ?? null),
		getAuthHeader: () => Promise.resolve(null),
		create: (input: {
			name: string;
			url: string;
			authHeader?: string;
			userId: string;
		}) => {
			const row: McpServerRow = {
				id: crypto.randomUUID(),
				name: input.name,
				url: input.url,
				userId: input.userId,
				authLast4: input.authHeader?.slice(-4) ?? null,
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
	const serverStore = memoryServerStore();
	const services = {
		authz: { enabled: false },
		mcp: () =>
			Promise.resolve({
				listTools: () =>
					Promise.resolve([
						{ name: "X_SEARCH", description: "", parameters: {} },
					]),
				execute: () => Promise.resolve({ output: "" }),
			}),
		stores: {
			activity: { log: () => Promise.resolve() },
			agent: { unlinkMcpServer: () => Promise.resolve() },
			mcpServer: serverStore,
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
	return { serverStore, clientFor };
}

it("servers are scoped to their owner; foreign access is NOT_FOUND", async () => {
	const { clientFor } = build();
	const alice = clientFor(ALICE);
	const bob = clientFor(BOB);

	const server = await alice.mcp.createServer({
		name: "X API",
		url: "https://api.x.com/mcp",
		bearerToken: "tok_1234",
	});
	expect(server.userId).toBe(ALICE.id);
	expect((await alice.mcp.listServers()).map((s) => s.id)).toContain(server.id);
	expect(await bob.mcp.listServers()).toHaveLength(0);

	await expect(bob.mcp.tools({ serverId: server.id })).rejects.toThrow();
	await expect(bob.mcp.deleteServer({ serverId: server.id })).rejects.toThrow();

	const tools = await alice.mcp.tools({ serverId: server.id });
	expect(tools[0]?.name).toBe("X_SEARCH");

	await alice.mcp.deleteServer({ serverId: server.id });
	expect(await alice.mcp.listServers()).toHaveLength(0);
});
