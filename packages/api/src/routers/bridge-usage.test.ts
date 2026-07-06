import type { BridgeAgentKindUsage } from "@better-agent/agent/bridge/usage-ports";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const ALICE = { id: "alice-uid", email: "alice@x.com", createdAt: new Date() };
const BOB = { id: "bob-uid", email: "bob@x.com", createdAt: new Date() };

const ALICE_USAGE: BridgeAgentKindUsage[] = [
	{
		agentKind: "claude-code",
		costUsd: 1.5,
		inputTokens: 300,
		outputTokens: 120,
		cacheReadTokens: 40,
		cacheCreationTokens: 10,
		turns: 4,
	},
];

// Owner-scoped fake: only ALICE's id yields her usage; anyone else sees none.
function usageForUser(userId: string): Promise<BridgeAgentKindUsage[]> {
	return Promise.resolve(userId === ALICE.id ? ALICE_USAGE : []);
}

function clientFor(user: typeof ALICE) {
	const services = {
		stores: { bridgeUsage: { usageByAgentKind: usageForUser } },
	};
	return createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: user,
			authedBridgeToken: null,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
}

it("usageByAgentKind returns the per-kind breakdown for the authed user", async () => {
	const res = await clientFor(ALICE).bridge.usageByAgentKind({ windowDays: 7 });
	expect(res.windowDays).toBe(7);
	expect(res.byKind).toEqual(ALICE_USAGE);
});

it("usageByAgentKind is owner-scoped: another user's sessions are excluded", async () => {
	const res = await clientFor(BOB).bridge.usageByAgentKind({ windowDays: 12 });
	expect(res.windowDays).toBe(12);
	expect(res.byKind).toEqual([]);
});
