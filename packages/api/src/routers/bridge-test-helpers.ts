import { createInMemoryRelayStore } from "@better-agent/agent/bridge/relay-store";
import type {
	BridgeAgentKind,
	BridgeSessionRow,
	BridgeSessionStore,
	BridgeTokenRow,
	BridgeTokenStore,
} from "@better-agent/agent/ports";
import { createRouterClient } from "@orpc/server";
import type { AuthedBridgeToken } from "../context";
import { appRouter } from "./index";

// Shared fixtures for the bridge router tests (bridge.test.ts and
// bridge-limits.test.ts), kept in one place so both stay under the
// per-file line cap without duplicating the in-memory store wiring.

export function fakeHonoRequest(authHeader?: string) {
	const header = (name: string) =>
		name.toLowerCase() === "authorization" ? authHeader : undefined;
	return { req: { header } } as never;
}

export const ALICE = {
	id: "alice-uid",
	email: "alice@x.com",
	createdAt: new Date(),
	blocked: false,
};
export const BOB = {
	id: "bob-uid",
	email: "bob@x.com",
	createdAt: new Date(),
	blocked: false,
};
export const AGENT_KIND: BridgeAgentKind = "claude-code";

function memoryBridgeTokenStore(): BridgeTokenStore {
	const rows = new Map<string, BridgeTokenRow>();
	const hashes = new Map<string, string>();
	return {
		create({ userId, name, tokenHash, last4 }) {
			const row: BridgeTokenRow = {
				id: crypto.randomUUID(),
				userId,
				name: name ?? null,
				last4: last4 ?? null,
				createdAt: new Date(),
				revokedAt: null,
			};
			rows.set(row.id, row);
			hashes.set(row.id, tokenHash);
			return Promise.resolve(row);
		},
		listByUser(userId) {
			return Promise.resolve(
				[...rows.values()].filter((row) => row.userId === userId)
			);
		},
		findByHash(tokenHash) {
			const found = [...hashes.entries()].find(
				([, hash]) => hash === tokenHash
			);
			const row = found && rows.get(found[0]);
			return Promise.resolve(
				row
					? { id: row.id, userId: row.userId, revokedAt: row.revokedAt }
					: null
			);
		},
		revoke(id, userId) {
			const row = rows.get(id);
			if (row && row.userId === userId) {
				rows.set(id, { ...row, revokedAt: new Date() });
			}
			return Promise.resolve();
		},
	};
}

function memoryBridgeSessionStore(): BridgeSessionStore {
	const rows = new Map<string, BridgeSessionRow>();
	return {
		create({ userId, tokenId, agentKind, label }) {
			const row: BridgeSessionRow = {
				id: crypto.randomUUID(),
				userId,
				tokenId,
				agentKind,
				label: label ?? null,
				status: "active",
				createdAt: new Date(),
				lastSeenAt: new Date(),
			};
			rows.set(row.id, row);
			return Promise.resolve(row);
		},
		get(id) {
			return Promise.resolve(rows.get(id) ?? null);
		},
		listByUser(userId) {
			return Promise.resolve(
				[...rows.values()].filter((row) => row.userId === userId)
			);
		},
		touch(id) {
			const row = rows.get(id);
			if (row) {
				rows.set(id, { ...row, lastSeenAt: new Date() });
			}
			return Promise.resolve();
		},
		end(id, userId) {
			const row = rows.get(id);
			if (row && row.userId === userId) {
				rows.set(id, { ...row, status: "ended" });
			}
			return Promise.resolve();
		},
	};
}

export function build() {
	const bridgeToken = memoryBridgeTokenStore();
	const bridgeSession = memoryBridgeSessionStore();
	const relayStore = createInMemoryRelayStore();
	const services = {
		relayStore,
		stores: { bridgeToken, bridgeSession },
	};
	const userClientFor = (user: typeof ALICE) =>
		createRouterClient(appRouter, {
			context: {
				services: services as never,
				authedAgent: null,
				authedUser: user,
				clientIp: "127.0.0.1",
				userAgent: null,
			},
		});
	const bridgeClientFor = (bridgeAuth: AuthedBridgeToken) =>
		createRouterClient(appRouter, {
			context: {
				services: services as never,
				authedAgent: null,
				authedUser: null,
				authedBridgeToken: bridgeAuth,
				clientIp: "127.0.0.1",
				userAgent: null,
			},
		});
	return {
		bridgeToken,
		bridgeSession,
		services,
		userClientFor,
		bridgeClientFor,
	};
}
