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
	createFakeTitler,
} from "../testing/fakes";
import type { RunEvent } from "./events";
import { createSessionRuntime } from "./runtime";
import { createInMemorySessionLock } from "./session-lock";
import type { Message } from "./types";

const INPUT = 5;
const OUTPUT = 2;

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
	{ type: "text-delta", id: "0", delta: "hi" },
	{ type: "text-end", id: "0" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: v3Usage(INPUT, OUTPUT),
	},
];

function happyModel(): LanguageModelV3 {
	return new MockLanguageModelV3({
		doStream: () =>
			Promise.resolve({ stream: simulateReadableStream({ chunks: HAPPY }) }),
	});
}

async function setup(
	titler = createFakeTitler("Greeting Chat"),
	sessionTitle: string | null = null
) {
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
		tokenHash: "hash-title",
	});
	const session = await sessionStore.create({ agentId: agent.id });
	if (sessionTitle) {
		await sessionStore.setTitle(session.id, sessionTitle);
	}
	const runtime = createSessionRuntime({
		sessionStore,
		messageStore,
		agentStore,
		modelFactory: {
			create: () => Promise.resolve(happyModel()),
		} as ModelFactory,
		sessionLock: createInMemorySessionLock(),
		modelCacheStore: createFakeModelStore(),
		providerCatalogStore: createFakeCatalogStore(),
		summarizer: createFakeSummarizer(),
		titler,
	});
	return { runtime, sessionStore, session, titler };
}

async function collect(gen: AsyncGenerator<RunEvent, Message>) {
	const events: RunEvent[] = [];
	let next = await gen.next();
	while (!next.done) {
		events.push(next.value);
		next = await gen.next();
	}
	return events;
}

it("generates and persists a title on the first turn", async () => {
	const { runtime, sessionStore, session, titler } = await setup();
	const events = await collect(
		runtime.runTurn({ sessionId: session.id, text: "hello" })
	);
	expect(
		events.some((e) => e.type === "title" && e.title === "Greeting Chat")
	).toBe(true);
	expect((await sessionStore.get(session.id))?.title).toBe("Greeting Chat");
	expect(titler.calls).toBe(1);
});

it("skips title generation when the session already has a title", async () => {
	const { runtime, session, titler } = await setup(
		createFakeTitler("X"),
		"Existing"
	);
	const events = await collect(
		runtime.runTurn({ sessionId: session.id, text: "hello" })
	);
	expect(events.some((e) => e.type === "title")).toBe(false);
	expect(titler.calls).toBe(0);
});
