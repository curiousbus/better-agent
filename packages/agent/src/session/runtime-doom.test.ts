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
import { DOOM_LOOP_MESSAGE } from "./doom-loop";
import type { RunEvent } from "./events";
import { createSessionRuntime } from "./runtime";
import { createInMemorySessionLock } from "./session-lock";
import type { Message } from "./types";

const IN = 10;
const OUT = 5;
const STOP_STEP = 4;

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

const REPEAT_CALL: LanguageModelV3StreamPart[] = [
	{ type: "tool-call", toolCallId: "c", toolName: "spin", input: "{}" },
	{
		type: "finish",
		finishReason: { unified: "tool-calls", raw: "tool_calls" },
		usage: v3Usage(IN, OUT),
	},
];
const FINAL_TEXT: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "done" },
	{ type: "text-end", id: "0" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: v3Usage(IN, OUT),
	},
];

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
		tokenHash: "hash-doom",
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

it("blocks the 3rd identical tool call with a guard message", async () => {
	let executeCount = 0;
	const spin: ToolDef = {
		name: "spin",
		description: "spin",
		parameters: { type: "object", properties: {} },
		execute: () => {
			executeCount += 1;
			return Promise.resolve({ output: "ok" });
		},
	};
	let step = 0;
	const model = new MockLanguageModelV3({
		doStream: () => {
			step += 1;
			const chunks = step < STOP_STEP ? REPEAT_CALL : FINAL_TEXT;
			return Promise.resolve({ stream: simulateReadableStream({ chunks }) });
		},
	});
	const { runtime, session } = await setup(model);
	const events = await collect(
		runtime.runTurn({ sessionId: session.id, text: "go", tools: [spin] })
	);
	expect(executeCount).toBe(2);
	const guarded = events.some(
		(e) => e.type === "tool-result" && e.result === DOOM_LOOP_MESSAGE
	);
	expect(guarded).toBe(true);
});
