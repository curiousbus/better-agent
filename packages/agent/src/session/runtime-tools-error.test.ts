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
const MIN_RESULTS = 2;

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
		composioAccountIds: [],
		mcpServerIds: [],
		builtinTools: [],
		tokenHash: "hash-tools-err",
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

interface ToolResultEvent {
	callId: string;
	isError: boolean;
	result: unknown;
	type: "tool-result";
}
async function assertToolErrorPersisted(
	messageStore: ReturnType<typeof createFakeMessageStore>,
	sessionId: string,
	events: RunEvent[]
) {
	const resultEvents = events.filter(
		(e) => e.type === "tool-result"
	) as ToolResultEvent[];
	expect(resultEvents.length).toBeGreaterThan(0);
	expect(resultEvents.some((e) => e.isError)).toBe(true);

	const allParts = (await messageStore.listWithParts(sessionId)).flatMap(
		(g) => g.parts
	);
	const errorPart = allParts.find(
		(p) =>
			p.type === "tool-result" &&
			(p.content as { isError?: boolean }).isError === true
	);
	expect(errorPart).toBeDefined();

	const assistantMsg = (await messageStore.listWithParts(sessionId)).find(
		(g) => g.message.role === "assistant"
	);
	expect(assistantMsg?.message.status).toBe("complete");
}

const FAIL_TOOL_NAME = "fail";
const FAIL_STEP1: LanguageModelV3StreamPart[] = [
	{
		type: "tool-call",
		toolCallId: "call-fail-1",
		toolName: FAIL_TOOL_NAME,
		input: JSON.stringify({}),
	},
	{
		type: "finish",
		finishReason: { unified: "tool-calls", raw: "tool_calls" },
		usage: v3Usage(INPUT_TOKENS, OUTPUT_TOKENS),
	},
];

const FAIL_STEP2: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "Done after error" },
	{ type: "text-end", id: "0" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: v3Usage(INPUT_TOKENS_2, OUTPUT_TOKENS_2),
	},
];

const failTool: ToolDef = {
	name: FAIL_TOOL_NAME,
	description: "always fails",
	parameters: { type: "object", properties: {} },
	execute: (_args, _ctx) => Promise.reject(new Error("boom")),
};

// Regression: when a tool's execute throws, drainStream must persist a
// tool-result part with isError:true (not leave a dangling tool-call).
it("persists a tool-result with isError:true when tool execute throws", async () => {
	let callStep = 0;
	const model = new MockLanguageModelV3({
		doStream: () => {
			callStep++;
			const chunks = callStep === 1 ? FAIL_STEP1 : FAIL_STEP2;
			return Promise.resolve({ stream: simulateReadableStream({ chunks }) });
		},
	});

	const { runtime, messageStore, session } = await setup(model);
	const events = await collectEvents(
		runtime.runTurn({ sessionId: session.id, text: "go", tools: [failTool] })
	);
	await assertToolErrorPersisted(messageStore, session.id, events);
});

const RESOLVE_ERR_TOOL_NAME = "resolve-err";

const RESOLVE_ERR_STEP1: LanguageModelV3StreamPart[] = [
	{
		type: "tool-call",
		toolCallId: "call-resolve-err-1",
		toolName: RESOLVE_ERR_TOOL_NAME,
		input: JSON.stringify({}),
	},
	{
		type: "finish",
		finishReason: { unified: "tool-calls", raw: "tool_calls" },
		usage: v3Usage(INPUT_TOKENS, OUTPUT_TOKENS),
	},
];

const RESOLVE_ERR_STEP2: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "r2" },
	{ type: "text-delta", id: "r2", delta: "Done after resolve-error" },
	{ type: "text-end", id: "r2" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: v3Usage(INPUT_TOKENS_2, OUTPUT_TOKENS_2),
	},
];

// The resolve-error tool RESOLVES (not throws) but sets isError:true; the
// registry must throw so the AI SDK emits a tool-error chunk → drainStream.
const resolveErrTool: ToolDef = {
	name: RESOLVE_ERR_TOOL_NAME,
	description: "resolves with isError:true",
	parameters: { type: "object", properties: {} },
	execute: (_args, _ctx) => Promise.resolve({ output: "boom", isError: true }),
};

it("persists a tool-result with isError:true when tool resolves with isError:true", async () => {
	let callStep = 0;
	const model = new MockLanguageModelV3({
		doStream: () => {
			callStep++;
			const chunks = callStep === 1 ? RESOLVE_ERR_STEP1 : RESOLVE_ERR_STEP2;
			return Promise.resolve({ stream: simulateReadableStream({ chunks }) });
		},
	});

	const { runtime, messageStore, session } = await setup(model);
	const events = await collectEvents(
		runtime.runTurn({
			sessionId: session.id,
			text: "go",
			tools: [resolveErrTool],
		})
	);
	await assertToolErrorPersisted(messageStore, session.id, events);
});

// ── cross-step text ordering scenario ────────────────────────────────────────
const ORDER_CALL_ID = "call-order-1";
const ORDER_TOOL_NAME = "noop";
const ORDER_STEP1: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "s1" },
	{ type: "text-delta", id: "s1", delta: "Before" },
	{ type: "text-end", id: "s1" },
	{
		type: "tool-call",
		toolCallId: ORDER_CALL_ID,
		toolName: ORDER_TOOL_NAME,
		input: JSON.stringify({}),
	},
	{
		type: "finish",
		finishReason: { unified: "tool-calls", raw: "tool_calls" },
		usage: v3Usage(INPUT_TOKENS, OUTPUT_TOKENS),
	},
];

const ORDER_STEP2: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "s2" },
	{ type: "text-delta", id: "s2", delta: "After" },
	{ type: "text-end", id: "s2" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: v3Usage(INPUT_TOKENS_2, OUTPUT_TOKENS_2),
	},
];

const noopTool: ToolDef = {
	name: ORDER_TOOL_NAME,
	description: "noop",
	parameters: { type: "object", properties: {} },
	execute: (_args, _ctx) => Promise.resolve({ output: "ok" }),
};

// Regression: text emitted in step 1, then a tool-call/result, then text in
// step 2 must persist as distinct parts in order: text(step1), tool-call,
// tool-result, text(step2).
it("creates distinct text parts per step so cross-step order is correct", async () => {
	let orderStep = 0;
	const model = new MockLanguageModelV3({
		doStream: () => {
			orderStep++;
			const chunks = orderStep === 1 ? ORDER_STEP1 : ORDER_STEP2;
			return Promise.resolve({ stream: simulateReadableStream({ chunks }) });
		},
	});

	const { runtime, messageStore, session } = await setup(model);
	await collectEvents(
		runtime.runTurn({
			sessionId: session.id,
			text: "order test",
			tools: [noopTool],
		})
	);

	const assistantGroup = (await messageStore.listWithParts(session.id)).find(
		(g) => g.message.role === "assistant"
	);
	const assistantParts = assistantGroup?.parts ?? [];
	const textParts = assistantParts.filter((p) => p.type === "text");
	const toolCallIdx = assistantParts.findIndex((p) => p.type === "tool-call");
	const toolResultIdx = assistantParts.findIndex(
		(p) => p.type === "tool-result"
	);
	const firstTextIdx = assistantParts.findIndex((p) => p.type === "text");
	const lastTextIdx = assistantParts.map((p) => p.type).lastIndexOf("text");

	expect(textParts.length).toBeGreaterThanOrEqual(MIN_RESULTS);
	expect(firstTextIdx).toBeLessThan(toolCallIdx);
	expect(toolCallIdx).toBeLessThan(toolResultIdx);
	expect(lastTextIdx).toBeGreaterThan(toolResultIdx);
});
