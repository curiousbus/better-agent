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

const SCHEMA = { type: "object", properties: { answer: { type: "number" } } };
const INPUT_TOKENS = 10;
const OUTPUT_TOKENS = 5;
const SIMPLE_INPUT = 5;
const SIMPLE_OUTPUT = 2;
const ANSWER_ONE_STEP = 42;
const ANSWER_TWO_STEP = 7;

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

function structuredCallChunks(value: unknown): LanguageModelV3StreamPart[] {
	return [
		{
			type: "tool-call",
			toolCallId: "so-1",
			toolName: "StructuredOutput",
			input: JSON.stringify(value),
		},
		{
			type: "finish",
			finishReason: { unified: "tool-calls", raw: "tool_calls" },
			usage: v3Usage(INPUT_TOKENS, OUTPUT_TOKENS),
		},
	];
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
		tokenHash: "hash-so",
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
	return { runtime, session };
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

it("returns the structured args when the model submits in one step", async () => {
	const model = new MockLanguageModelV3({
		doStream: () =>
			Promise.resolve({
				stream: simulateReadableStream({
					chunks: structuredCallChunks({ answer: ANSWER_ONE_STEP }),
				}),
			}),
	});
	const { runtime, session } = await setup(model);
	const events = await collect(
		runtime.runTurn({ sessionId: session.id, text: "go", outputSchema: SCHEMA })
	);
	const done = events.find((e) => e.type === "done");
	expect(done && "structured" in done && done.structured).toEqual({
		answer: ANSWER_ONE_STEP,
	});
});

it("gathers via a tool then submits structured output", async () => {
	const echoTool: ToolDef = {
		name: "echo",
		description: "echo",
		parameters: { type: "object", properties: {} },
		execute: () => Promise.resolve({ output: "DATA" }),
	};
	let step = 0;
	const model = new MockLanguageModelV3({
		doStream: () => {
			step++;
			const chunks: LanguageModelV3StreamPart[] =
				step === 1
					? [
							{
								type: "tool-call",
								toolCallId: "echo-1",
								toolName: "echo",
								input: "{}",
							},
							{
								type: "finish",
								finishReason: { unified: "tool-calls", raw: "tool_calls" },
								usage: v3Usage(INPUT_TOKENS, OUTPUT_TOKENS),
							},
						]
					: structuredCallChunks({ answer: ANSWER_TWO_STEP });
			return Promise.resolve({
				stream: simulateReadableStream({ chunks }),
			});
		},
	});
	const { runtime, session } = await setup(model);
	const events = await collect(
		runtime.runTurn({
			sessionId: session.id,
			text: "go",
			tools: [echoTool],
			outputSchema: SCHEMA,
		})
	);
	expect(events.some((e) => e.type === "tool-result")).toBe(true);
	const done = events.find((e) => e.type === "done");
	expect(done && "structured" in done && done.structured).toEqual({
		answer: ANSWER_TWO_STEP,
	});
});

it("leaves structured null when the model never submits", async () => {
	const happy: LanguageModelV3StreamPart[] = [
		{ type: "text-start", id: "0" },
		{ type: "text-delta", id: "0", delta: "hi" },
		{ type: "text-end", id: "0" },
		{
			type: "finish",
			finishReason: { unified: "stop", raw: "stop" },
			usage: v3Usage(SIMPLE_INPUT, SIMPLE_OUTPUT),
		},
	];
	const model = new MockLanguageModelV3({
		doStream: () =>
			Promise.resolve({ stream: simulateReadableStream({ chunks: happy }) }),
	});
	const { runtime, session } = await setup(model);
	const events = await collect(
		runtime.runTurn({ sessionId: session.id, text: "go", outputSchema: SCHEMA })
	);
	const done = events.find((e) => e.type === "done");
	expect(done && "structured" in done ? done.structured : "MISSING").toBeNull();
});
