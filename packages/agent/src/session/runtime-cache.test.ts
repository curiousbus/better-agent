import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { expect, it } from "vitest";
import { createFakeAgentStore } from "../testing/fake-agent-store";
import {
	createFakeCatalogStore,
	createFakeMessageStore,
	createFakeModelStore,
	createFakeSessionStore,
	createFakeSummarizer,
} from "../testing/fakes";
import type { RunEvent } from "./events";
import { createSessionRuntime } from "./runtime";
import { createInMemorySessionLock } from "./session-lock";
import type { Message } from "./types";

const HAPPY_CHUNKS = [
	{ type: "text-start" as const, id: "0" },
	{ type: "text-delta" as const, id: "0", delta: "Hello" },
	{ type: "text-end" as const, id: "0" },
	{
		type: "finish" as const,
		finishReason: { unified: "stop" as const, raw: "stop" },
		usage: {
			inputTokens: {
				total: 10,
				noCache: undefined,
				cacheRead: undefined,
				cacheWrite: undefined,
			},
			outputTokens: { total: 5, text: undefined, reasoning: undefined },
		},
	},
];

async function drain(gen: AsyncGenerator<RunEvent, Message>) {
	while (!(await gen.next()).done) {
		// drain
	}
}

it("passes promptCacheKey from cache policy to the model via providerOptions", async () => {
	const agentStore = createFakeAgentStore();
	const sessionStore = createFakeSessionStore();
	const messageStore = createFakeMessageStore();
	const providerCatalogStore = createFakeCatalogStore();
	await providerCatalogStore.replaceAll([
		{
			providerId: "openai",
			npm: "@ai-sdk/openai",
			name: "OpenAI",
			defaultBaseURL: null,
			envKeys: [],
		},
	]);
	const agent = await agentStore.create({
		name: "CacheHelper",
		description: "d",
		systemPrompt: "You are helpful.",
		providerId: "openai",
		modelId: "gpt-x",
		params: null,
		tokenHash: "hash-cache-test",
	});
	const session = await sessionStore.create({ agentId: agent.id });
	const capturedModel = new MockLanguageModelV3({
		doStream: () =>
			Promise.resolve({
				stream: simulateReadableStream({ chunks: HAPPY_CHUNKS }),
			}),
	});
	const runtime = createSessionRuntime({
		sessionStore,
		messageStore,
		agentStore,
		modelFactory: { create: () => Promise.resolve(capturedModel) },
		sessionLock: createInMemorySessionLock(),
		modelCacheStore: createFakeModelStore(),
		providerCatalogStore,
		summarizer: createFakeSummarizer(),
	});
	await drain(runtime.runTurn({ sessionId: session.id, text: "hi" }));
	const call = capturedModel.doStreamCalls[0];
	expect(call?.providerOptions?.openai?.promptCacheKey).toBe(session.id);
});
