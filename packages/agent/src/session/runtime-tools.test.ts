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
import type { ToolDef } from "../tool/types";
import type { RunEvent } from "./events";
import { createSessionRuntime } from "./runtime";
import { createInMemorySessionLock } from "./session-lock";
import type { Message } from "./types";

const INPUT_TOKENS = 10;
const OUTPUT_TOKENS = 5;
const INPUT_TOKENS_2 = 15;
const OUTPUT_TOKENS_2 = 3;
const INPUT_TOKENS_SIMPLE = 5;
const OUTPUT_TOKENS_SIMPLE = 2;

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

async function setup(model: LanguageModelV3) {
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
		composioToolkits: [],
		tokenHash: "hash-tools",
	});
	const session = await sessionStore.create({ agentId: agent.id });
	const runtime = createSessionRuntime({
		sessionStore,
		messageStore,
		agentStore,
		modelFactory: { create: () => Promise.resolve(model) } as ModelFactory,
		sessionLock: createInMemorySessionLock(),
		modelCacheStore: createFakeModelStore(),
		providerCatalogStore: createFakeCatalogStore(),
		summarizer: createFakeSummarizer(),
	});
	return { runtime, sessionStore, messageStore, session };
}

async function collectEvents(gen: AsyncGenerator<RunEvent, Message>) {
	const events: RunEvent[] = [];
	let next = await gen.next();
	while (!next.done) {
		events.push(next.value);
		next = await gen.next();
	}
	return events;
}

// Step 1: tool-call + finish(tool-calls); Step 2: text + finish(stop)
const TOOL_CALL_ID = "call-echo-1";
const TOOL_NAME = "echo";

const STEP_1_CHUNKS: LanguageModelV3StreamPart[] = [
	{
		type: "tool-call",
		toolCallId: TOOL_CALL_ID,
		toolName: TOOL_NAME,
		input: JSON.stringify({}),
	},
	{
		type: "finish",
		finishReason: { unified: "tool-calls", raw: "tool_calls" },
		usage: v3Usage(INPUT_TOKENS, OUTPUT_TOKENS),
	},
];

const STEP_2_CHUNKS: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "Done" },
	{ type: "text-end", id: "0" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: v3Usage(INPUT_TOKENS_2, OUTPUT_TOKENS_2),
	},
];

it("runs an in-process tool and persists the call + result", async () => {
	let executeCount = 0;
	const echoTool: ToolDef = {
		name: TOOL_NAME,
		description: "echo",
		parameters: { type: "object", properties: {} },
		execute: (_args, _ctx) => {
			executeCount++;
			return Promise.resolve({ output: "RESULT" });
		},
	};

	let step = 0;
	const model = new MockLanguageModelV3({
		doStream: () => {
			step++;
			const chunks = step === 1 ? STEP_1_CHUNKS : STEP_2_CHUNKS;
			return Promise.resolve({
				stream: simulateReadableStream({ chunks }),
			});
		},
	});

	const { runtime, messageStore, session } = await setup(model);
	const events = await collectEvents(
		runtime.runTurn({ sessionId: session.id, text: "go", tools: [echoTool] })
	);

	expect(events.some((e) => e.type === "tool-call")).toBe(true);
	expect(events.some((e) => e.type === "tool-result")).toBe(true);

	const allParts = (await messageStore.listWithParts(session.id)).flatMap(
		(g) => g.parts
	);
	expect(allParts.some((p) => p.type === "tool-call")).toBe(true);
	expect(allParts.some((p) => p.type === "tool-result")).toBe(true);

	expect(executeCount).toBeGreaterThan(0);

	const finalStatus = (await messageStore.listWithParts(session.id)).find(
		(g) => g.message.role === "assistant"
	)?.message.status;
	expect(finalStatus).toBe("complete");
});

it("no tools provided behaves identically to single-step text turn", async () => {
	const HAPPY: LanguageModelV3StreamPart[] = [
		{ type: "text-start", id: "0" },
		{ type: "text-delta", id: "0", delta: "Hi" },
		{ type: "text-end", id: "0" },
		{
			type: "finish",
			finishReason: { unified: "stop", raw: "stop" },
			usage: v3Usage(INPUT_TOKENS_SIMPLE, OUTPUT_TOKENS_SIMPLE),
		},
	];
	const model = new MockLanguageModelV3({
		doStream: () =>
			Promise.resolve({ stream: simulateReadableStream({ chunks: HAPPY }) }),
	});
	const { runtime, messageStore, session } = await setup(model);
	const events = await collectEvents(
		runtime.runTurn({ sessionId: session.id, text: "hello" })
	);
	expect(events.some((e) => e.type === "text-delta")).toBe(true);
	expect(events.some((e) => e.type === "tool-call")).toBe(false);
	const assistant = (await messageStore.listWithParts(session.id)).find(
		(g) => g.message.role === "assistant"
	);
	expect(assistant?.message.status).toBe("complete");
	expect((assistant?.parts ?? []).some((p) => p.type === "tool-call")).toBe(
		false
	);
});
