import type {
	LanguageModelV3,
	LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import type { RunEvent } from "@better-agent/agent/session/events";
import { createSessionRuntime } from "@better-agent/agent/session/runtime";
import { createFakeAgentStore } from "@better-agent/agent/testing/fake-agent-store";
import {
	createFakeMessageStore,
	createFakeSessionStore,
} from "@better-agent/agent/testing/fakes";
import { createRouterClient } from "@orpc/server";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const HAPPY: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "Hi there" },
	{ type: "text-end", id: "0" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: {
			inputTokens: {
				total: 3,
				noCache: undefined,
				cacheRead: undefined,
				cacheWrite: undefined,
			},
			outputTokens: { total: 2, text: undefined, reasoning: undefined },
		},
	},
];

function mockModel(chunks: LanguageModelV3StreamPart[]): LanguageModelV3 {
	return new MockLanguageModelV3({
		doStream: () =>
			Promise.resolve({ stream: simulateReadableStream({ chunks }) }),
	});
}

async function buildClient() {
	const agentStore = createFakeAgentStore();
	const sessionStore = createFakeSessionStore();
	const messageStore = createFakeMessageStore();
	const agent = await agentStore.create({
		name: "Helper",
		description: "d",
		systemPrompt: "You are helpful.",
		providerId: "openai",
		modelId: "gpt-x",
		params: null,
		tokenHash: "hash-sessions",
	});
	const runtime = createSessionRuntime({
		sessionStore,
		messageStore,
		agentStore,
		modelFactory: { create: () => Promise.resolve(mockModel(HAPPY)) },
	});
	const services = {
		// only the fields the sessions router touches are needed for these tests
		runtime,
		stores: { agent: agentStore, session: sessionStore, message: messageStore },
	};
	const client = createRouterClient(appRouter, {
		context: { services: services as never },
	});
	return { client, agentId: agent.id };
}

it("create rejects an unknown agent and accepts a known one", async () => {
	const { client, agentId } = await buildClient();
	await expect(
		client.sessions.create({ agentId: "00000000-0000-0000-0000-000000000000" })
	).rejects.toThrow();
	const session = await client.sessions.create({ agentId });
	expect(session.id).toBeTruthy();
	expect(session.agentId).toBe(agentId);
});

it("run returns the final assistant message and listMessages replays history", async () => {
	const { client, agentId } = await buildClient();
	const session = await client.sessions.create({ agentId });
	const final = await client.sessions.run({
		sessionId: session.id,
		text: "hello",
	});
	expect(final.role).toBe("assistant");
	expect(final.status).toBe("complete");

	const history = await client.sessions.listMessages({ sessionId: session.id });
	expect(history.map((h) => h.message.role)).toEqual(["user", "assistant"]);
	expect(history[1]?.parts[0]?.content).toEqual({ text: "Hi there" });
});

it("prompt streams run events ending with done", async () => {
	const { client, agentId } = await buildClient();
	const session = await client.sessions.create({ agentId });
	const events: RunEvent[] = [];
	for await (const event of await client.sessions.prompt({
		sessionId: session.id,
		text: "hello",
	})) {
		events.push(event);
	}
	expect(events.some((e) => e.type === "message-start")).toBe(true);
	expect(events.at(-1)?.type).toBe("done");
});

it("run rejects an unknown session", async () => {
	const { client } = await buildClient();
	await expect(
		client.sessions.run({
			sessionId: "00000000-0000-0000-0000-000000000000",
			text: "hi",
		})
	).rejects.toThrow();
});

it("prompt yields an error event (not throw) for an unknown session", async () => {
	const { client } = await buildClient();
	const events: RunEvent[] = [];
	for await (const event of await client.sessions.prompt({
		sessionId: "00000000-0000-0000-0000-000000000000",
		text: "hi",
	})) {
		events.push(event);
	}
	expect(events).toHaveLength(1);
	expect(events[0]?.type).toBe("error");
});
