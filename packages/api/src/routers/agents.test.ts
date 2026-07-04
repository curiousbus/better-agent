import { SUPER_ADMIN_EMAIL } from "@better-agent/agent/auth/admin";
import { createTokenService } from "@better-agent/agent/crypto/agent-token";
import { createFakeAgentStore } from "@better-agent/agent/testing/fake-agent-store";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const ADMIN_USER = {
	id: "admin-uid",
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
	authedUser = ADMIN_USER,
	agentStore = createFakeAgentStore(),
	ownedComposioIds: string[] = []
) {
	const tokenService = createTokenService();
	const services = {
		authz: { enabled: false },
		tokenService,
		authConfig: AUTH_CONFIG,
		agentValidator: { validate: () => Promise.resolve(null) },
		stores: {
			activity: { log: () => Promise.resolve() },
			agent: agentStore,
			composioAccount: {
				listByUser: () =>
					Promise.resolve(ownedComposioIds.map((id) => ({ id }))),
			},
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
	return { client, tokenService, agentStore };
}

const INPUT = {
	name: "Helper",
	description: "d",
	systemPrompt: "s",
	providerId: "openai",
	modelId: "gpt-x",
	params: null,
};

it("create returns the agent plus a one-time ba_ token", async () => {
	const { client, tokenService, agentStore } = buildClient();
	const result = await client.agents.create(INPUT);
	expect(result.token.startsWith("ba_")).toBe(true);
	expect(result.agent.name).toBe("Helper");
	// the stored hash resolves back to the created agent
	const found = await agentStore.findByTokenHash(
		tokenService.hash(result.token)
	);
	expect(found?.id).toBe(result.agent.id);
});

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_C = "33333333-3333-4333-8333-333333333333";

it("round-trips composioAccountIds on create and update", async () => {
	const { client } = buildClient(ADMIN_USER, createFakeAgentStore(), [
		ACCOUNT_A,
		ACCOUNT_B,
		ACCOUNT_C,
	]);
	const { agent } = await client.agents.create({
		...INPUT,
		composioAccountIds: [ACCOUNT_A],
	});
	expect(agent.composioAccountIds).toEqual([ACCOUNT_A]);
	const updated = await client.agents.update({
		id: agent.id,
		...INPUT,
		composioAccountIds: [ACCOUNT_B, ACCOUNT_C],
	});
	expect(updated.composioAccountIds).toEqual([ACCOUNT_B, ACCOUNT_C]);
});

it("drops a composio account the caller does not own", async () => {
	const { client } = buildClient(ADMIN_USER, createFakeAgentStore(), [
		ACCOUNT_A,
	]);
	// A non-owned (or since-deleted) id is silently filtered out rather than
	// rejected, so a save never locks up over a stale link.
	const { agent } = await client.agents.create({
		...INPUT,
		composioAccountIds: [ACCOUNT_A, ACCOUNT_B],
	});
	expect(agent.composioAccountIds).toEqual([ACCOUNT_A]);
});

it("scopes agents to their owner (isolation)", async () => {
	const store = createFakeAgentStore();
	const alice = { id: "a-uid", email: "alice@x.com", createdAt: new Date() };
	const bob = { id: "b-uid", email: "bob@x.com", createdAt: new Date() };
	const aliceApi = buildClient(alice, store).client;
	const bobApi = buildClient(bob, store).client;

	const { agent } = await aliceApi.agents.create(INPUT);
	expect((await aliceApi.agents.list()).map((a) => a.id)).toContain(agent.id);
	expect(await bobApi.agents.list()).toHaveLength(0);

	await expect(bobApi.agents.get({ id: agent.id })).rejects.toThrow();
	await expect(bobApi.agents.getToken({ id: agent.id })).rejects.toThrow();
	await expect(bobApi.agents.delete({ id: agent.id })).rejects.toThrow();
	await expect(bobApi.agents.rotateToken({ id: agent.id })).rejects.toThrow();
	await expect(
		bobApi.agents.update({ id: agent.id, ...INPUT })
	).rejects.toThrow();
});

it("rotateToken issues a new token and invalidates the old one", async () => {
	const { client, tokenService, agentStore } = buildClient();
	const created = await client.agents.create(INPUT);
	const rotated = await client.agents.rotateToken({ id: created.agent.id });
	expect(rotated.token).not.toBe(created.token);
	expect(
		await agentStore.findByTokenHash(tokenService.hash(created.token))
	).toBeNull();
	expect(
		(await agentStore.findByTokenHash(tokenService.hash(rotated.token)))?.id
	).toBe(created.agent.id);
});
