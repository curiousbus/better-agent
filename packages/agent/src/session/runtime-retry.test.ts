import type { LanguageModelV3 } from "@ai-sdk/provider";
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
import type { SessionRuntimeDeps } from "./runtime";
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

function fakeModelFactory(model: LanguageModelV3) {
	return { create: () => Promise.resolve(model) };
}

async function collect(gen: AsyncGenerator<RunEvent, Message>) {
	const events: RunEvent[] = [];
	let next = await gen.next();
	while (!next.done) {
		events.push(next.value);
		next = await gen.next();
	}
	return { events, final: next.value };
}

async function drainTurn(
	model: LanguageModelV3,
	depsOverrides?: Partial<SessionRuntimeDeps>
): Promise<Message> {
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
		composioAccountIds: [],
		tokenHash: "hash-retry",
	});
	const session = await sessionStore.create({ agentId: agent.id });
	const runtime = createSessionRuntime({
		sessionStore,
		messageStore,
		agentStore,
		modelFactory: fakeModelFactory(model),
		sessionLock: createInMemorySessionLock(),
		modelCacheStore: createFakeModelStore(),
		providerCatalogStore: createFakeCatalogStore(),
		summarizer: createFakeSummarizer(),
		...depsOverrides,
	});
	const { final } = await collect(
		runtime.runTurn({ sessionId: session.id, text: "hi" })
	);
	return final;
}

it("retries a retryable model failure then succeeds", async () => {
	let calls = 0;
	const model = new MockLanguageModelV3({
		doStream: () => {
			calls++;
			if (calls < 3) {
				return Promise.reject(
					Object.assign(new Error("overloaded"), { statusCode: 503 })
				);
			}
			return Promise.resolve({
				stream: simulateReadableStream({ chunks: HAPPY_CHUNKS }),
			});
		},
	});
	const final = await drainTurn(model, { sleep: () => Promise.resolve() });
	expect(calls).toBe(3);
	expect(final.status).toBe("complete");
});

it("does not retry a fatal model failure", async () => {
	let calls = 0;
	const model = new MockLanguageModelV3({
		doStream: () => {
			calls++;
			return Promise.reject(
				Object.assign(new Error("bad request"), { statusCode: 400 })
			);
		},
	});
	const final = await drainTurn(model, { sleep: () => Promise.resolve() });
	expect(calls).toBe(1);
	expect(final.status).toBe("error");
	expect(final.error?.category).toBe("fatal");
});
