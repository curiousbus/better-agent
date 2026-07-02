import type {
	LanguageModelV3,
	LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
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
import type { CancellationRegistry } from "./cancellation";
import type { RunEvent } from "./events";
import { createSessionRuntime } from "./runtime";
import { createInMemorySessionLock } from "./session-lock";
import type { Message } from "./types";

const IN = 5;
const OUT = 2;
const HAPPY: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "hi" },
	{ type: "text-end", id: "0" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: {
			inputTokens: {
				total: IN,
				noCache: undefined,
				cacheRead: undefined,
				cacheWrite: undefined,
			},
			outputTokens: { total: OUT, text: undefined, reasoning: undefined },
		},
	},
];

function spyRegistry(): CancellationRegistry & {
	registered: string[];
	unregistered: string[];
} {
	const registered: string[] = [];
	const unregistered: string[] = [];
	return {
		registered,
		unregistered,
		register(sessionId) {
			registered.push(sessionId);
		},
		unregister(sessionId) {
			unregistered.push(sessionId);
		},
		cancel() {
			return Promise.resolve();
		},
	};
}

async function drain(gen: AsyncGenerator<RunEvent, Message>) {
	let n = await gen.next();
	while (!n.done) {
		n = await gen.next();
	}
}

it("registers then unregisters the session around the turn", async () => {
	const agentStore = createFakeAgentStore();
	const sessionStore = createFakeSessionStore();
	const messageStore = createFakeMessageStore();
	const agent = await agentStore.create({
		name: "H",
		description: "d",
		systemPrompt: "s",
		providerId: "openai",
		modelId: "gpt-x",
		params: null,
		composioAccountIds: [],
		mcpServerIds: [],
		builtinTools: [],
		tokenHash: "h-cancel",
	});
	const session = await sessionStore.create({ agentId: agent.id });
	const cancellation = spyRegistry();
	const model: LanguageModelV3 = new MockLanguageModelV3({
		doStream: () =>
			Promise.resolve({ stream: simulateReadableStream({ chunks: HAPPY }) }),
	});
	const runtime = createSessionRuntime({
		sessionStore,
		messageStore,
		agentStore,
		modelFactory: { create: () => Promise.resolve(model) } as ModelFactory,
		sessionLock: createInMemorySessionLock(),
		modelCacheStore: createFakeModelStore(),
		providerCatalogStore: createFakeCatalogStore(),
		summarizer: createFakeSummarizer(),
		cancellation,
	});
	await drain(runtime.runTurn({ sessionId: session.id, text: "go" }));
	expect(cancellation.registered).toEqual([session.id]);
	expect(cancellation.unregistered).toEqual([session.id]);
});
