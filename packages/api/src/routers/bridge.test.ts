import { createInMemoryRelayStore } from "@better-agent/agent/bridge/relay-store";
import type {
	BridgeAgentKind,
	BridgeSessionRow,
	BridgeSessionStore,
	BridgeTokenRow,
	BridgeTokenStore,
} from "@better-agent/agent/ports";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import type { AuthedBridgeToken } from "../context";
import { appRouter } from "./index";

const ALICE = {
	id: "alice-uid",
	email: "alice@x.com",
	createdAt: new Date(),
	blocked: false,
};
const BOB = {
	id: "bob-uid",
	email: "bob@x.com",
	createdAt: new Date(),
	blocked: false,
};
const AGENT_KIND: BridgeAgentKind = "claude-code";

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

function build() {
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
	return { bridgeToken, bridgeSession, userClientFor, bridgeClientFor };
}

it("createToken mints a one-time bt_ token; listTokens never exposes it again", async () => {
	const { userClientFor } = build();
	const alice = userClientFor(ALICE);
	const created = await alice.bridge.createToken({ name: "laptop" });
	expect(created.token.startsWith("bt_")).toBe(true);
	expect(created.last4).toBe(created.token.slice(-4));

	const tokens = await alice.bridge.listTokens();
	expect(tokens).toHaveLength(1);
	expect(tokens[0]).not.toHaveProperty("token");
	expect(tokens[0]).not.toHaveProperty("tokenHash");
	expect(tokens[0]?.last4).toBe(created.last4);
});

it("revokeToken only revokes the caller's own token", async () => {
	const { userClientFor, bridgeToken } = build();
	const alice = userClientFor(ALICE);
	const bob = userClientFor(BOB);
	await alice.bridge.createToken({});

	const tokenId = (await bridgeToken.listByUser(ALICE.id))[0]?.id as string;

	await bob.bridge.revokeToken({ id: tokenId });
	expect((await bridgeToken.listByUser(ALICE.id))[0]?.revokedAt).toBeNull();

	await alice.bridge.revokeToken({ id: tokenId });
	expect((await bridgeToken.listByUser(ALICE.id))[0]?.revokedAt).not.toBeNull();
});

it("startSession binds a session to the bridge token's user", async () => {
	const { bridgeClientFor, bridgeSession } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	const row = await bridgeSession.get(sessionId);
	expect(row?.userId).toBe(ALICE.id);
	expect(row?.tokenId).toBe("tok-1");
});

it("a bridge-token session pushes events the owner can observe via poll", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	await cli.bridge.pushEvents({
		sessionId,
		events: [{ type: "stdout", chunk: "hello" }],
	});

	const alice = userClientFor(ALICE);
	const events = await alice.bridge.observe({ sessionId, afterId: 0 });
	expect(events).toHaveLength(1);
	expect(events[0]?.data).toEqual({ type: "stdout", chunk: "hello" });
});

it("observe rejects a non-owner with NOT_FOUND", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	await cli.bridge.pushEvents({ sessionId, events: [{ ok: true }] });

	const bob = userClientFor(BOB);
	await expect(
		bob.bridge.observe({ sessionId, afterId: 0 })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("pushEvents rejects a non-owner bridge token with NOT_FOUND", async () => {
	const { bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	const otherCli = bridgeClientFor({ tokenId: "tok-2", userId: BOB.id });
	await expect(
		otherCli.bridge.pushEvents({ sessionId, events: [{ ok: true }] })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("sendInput lands in pollCommands", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	const alice = userClientFor(ALICE);
	await alice.bridge.sendInput({ sessionId, data: { keys: "y\n" } });

	const commands = await cli.bridge.pollCommands({ sessionId, afterId: 0 });
	expect(commands).toHaveLength(1);
	expect(commands[0]?.data).toEqual({ keys: "y\n" });
});

it("listSessions and endSession are scoped to the caller", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	const alice = userClientFor(ALICE);
	const bob = userClientFor(BOB);

	expect(await bob.bridge.listSessions()).toHaveLength(0);
	expect(await alice.bridge.listSessions()).toHaveLength(1);

	await expect(bob.bridge.endSession({ sessionId })).rejects.toMatchObject({
		code: "NOT_FOUND",
	});

	await alice.bridge.endSession({ sessionId });
	const [session] = await alice.bridge.listSessions();
	expect(session?.status).toBe("ended");
});
