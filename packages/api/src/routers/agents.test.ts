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

function buildClient() {
	const tokenService = createTokenService();
	const agentStore = createFakeAgentStore();
	const services = {
		authz: { enabled: false },
		tokenService,
		authConfig: AUTH_CONFIG,
		agentValidator: { validate: () => Promise.resolve(null) },
		stores: { agent: agentStore },
	};
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: ADMIN_USER,
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

it("round-trips composioAccountIds on create and update", async () => {
	const { client } = buildClient();
	const accountA = "11111111-1111-4111-8111-111111111111";
	const accountB = "22222222-2222-4222-8222-222222222222";
	const accountC = "33333333-3333-4333-8333-333333333333";
	const { agent } = await client.agents.create({
		...INPUT,
		composioAccountIds: [accountA],
	});
	expect(agent.composioAccountIds).toEqual([accountA]);
	const updated = await client.agents.update({
		id: agent.id,
		...INPUT,
		composioAccountIds: [accountB, accountC],
	});
	expect(updated.composioAccountIds).toEqual([accountB, accountC]);
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
