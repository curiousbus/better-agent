import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { expect, it } from "vitest";
import type { ModelFactory } from "../provider/model-factory";
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

// --- Overflow / compaction integration ---

const TINY_CONTEXT_LIMIT = 50;
const PRIOR_PAIR_COUNT = 4;
const PRIOR_TEXT = "A".repeat(50);

function v3Usage(input: number, output: number) {
	return {
		inputTokens: {
			total: input,
			noCache: undefined,
			cacheRead: undefined,
			cacheWrite: undefined,
		},
		outputTokens: { total: output, text: undefined, reasoning: undefined },
	};
}

const HAPPY: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "Hello" },
	{ type: "text-end", id: "0" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: v3Usage(10, 5),
	},
];

function fakeModelFactory(chunks: LanguageModelV3StreamPart[]): ModelFactory {
	const model = new MockLanguageModelV3({
		doStream: () =>
			Promise.resolve({ stream: simulateReadableStream({ chunks }) }),
	});
	return { create: () => Promise.resolve(model) };
}

async function seedPriorMessages(
	messageStore: ReturnType<typeof createFakeMessageStore>,
	sessionId: string
): Promise<void> {
	for (let i = 0; i < PRIOR_PAIR_COUNT; i++) {
		const userMsg = await messageStore.createMessage({
			sessionId,
			role: "user",
			status: "complete",
			providerId: null,
			modelId: null,
		});
		await messageStore.appendPart({
			messageId: userMsg.id,
			type: "text",
			content: { text: PRIOR_TEXT },
			status: "complete",
		});
		const asstMsg = await messageStore.createMessage({
			sessionId,
			role: "assistant",
			status: "complete",
			providerId: "openai",
			modelId: "gpt-x",
		});
		await messageStore.appendPart({
			messageId: asstMsg.id,
			type: "text",
			content: { text: PRIOR_TEXT },
			status: "complete",
		});
	}
}

async function overflowSetup() {
	const agentStore = createFakeAgentStore();
	const sessionStore = createFakeSessionStore();
	const messageStore = createFakeMessageStore();
	const modelCacheStore = createFakeModelStore();
	const summarizer = createFakeSummarizer("RECAP");
	const agent = await agentStore.create({
		name: "Helper",
		description: "d",
		systemPrompt: "You are helpful.",
		providerId: "openai",
		modelId: "gpt-x",
		params: null,
		composioToolkits: [],
		tokenHash: "hash-overflow",
	});
	await modelCacheStore.replaceAll([
		{
			providerId: "openai",
			modelId: "gpt-x",
			name: "GPT-X",
			contextLimit: TINY_CONTEXT_LIMIT,
			maxOutputTokens: null,
			inputPricePerM: null,
			outputPricePerM: null,
			capabilities: { reasoning: false, toolCall: false, vision: false },
		},
	]);
	const session = await sessionStore.create({ agentId: agent.id });
	await seedPriorMessages(messageStore, session.id);
	const runtime = createSessionRuntime({
		sessionStore,
		messageStore,
		agentStore,
		modelFactory: fakeModelFactory(HAPPY),
		sessionLock: createInMemorySessionLock(),
		modelCacheStore,
		providerCatalogStore: createFakeCatalogStore(),
		summarizer,
	});
	return { runtime, session, summarizer, sessionStore };
}

async function drainTurn(gen: AsyncGenerator<RunEvent, Message>) {
	while (!(await gen.next()).done) {
		// drain
	}
}

it("compacts the session before streaming when the context would overflow", async () => {
	const { runtime, session, summarizer, sessionStore } = await overflowSetup();
	await drainTurn(runtime.runTurn({ sessionId: session.id, text: "next" }));
	expect(summarizer.calls.length).toBe(1);
	const updated = await sessionStore.get(session.id);
	expect(updated?.summary).toBe("RECAP");
	expect(updated?.compactedThroughSeq).not.toBeNull();
});
