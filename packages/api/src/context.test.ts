import { createTokenService } from "@better-agent/agent/crypto/agent-token";
import { createFakeAgentStore } from "@better-agent/agent/testing/fake-agent-store";
import { expect, it } from "vitest";
import { createContext } from "./context";
import type { AgentServices } from "./services";

function fakeHono(authHeader?: string) {
	return {
		req: {
			header: (name: string) =>
				name.toLowerCase() === "authorization" ? authHeader : undefined,
		},
	} as never;
}

async function setup() {
	const tokenService = createTokenService();
	const agentStore = createFakeAgentStore();
	const { token } = tokenService.generate();
	const created = await agentStore.create({
		name: "A",
		description: "d",
		systemPrompt: "s",
		providerId: "openai",
		modelId: "gpt-x",
		params: null,
		tokenHash: tokenService.hash(token),
	});
	const services = {
		tokenService,
		stores: { agent: agentStore },
	} as unknown as AgentServices;
	return { services, token, agentId: created.id };
}

it("resolves authedAgent from a valid Bearer token", async () => {
	const { services, token, agentId } = await setup();
	const ctx = await createContext({
		context: fakeHono(`Bearer ${token}`),
		services,
	});
	expect(ctx.authedAgent?.id).toBe(agentId);
});

it("authedAgent is null with no header", async () => {
	const { services } = await setup();
	const ctx = await createContext({ context: fakeHono(undefined), services });
	expect(ctx.authedAgent).toBeNull();
});

it("authedAgent is null for an unknown token", async () => {
	const { services } = await setup();
	const ctx = await createContext({
		context: fakeHono("Bearer ba_nope"),
		services,
	});
	expect(ctx.authedAgent).toBeNull();
});
