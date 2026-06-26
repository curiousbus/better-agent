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
import type { RunEvent } from "./events";
import { createSessionRuntime } from "./runtime";
import { createInMemorySessionLock } from "./session-lock";
import type { Message } from "./types";

const NOT_FOUND_RE = /not found/i;
const ALREADY_PROCESSING_RE = /already processing/i;

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

function scriptedModel(chunks: LanguageModelV3StreamPart[]): LanguageModelV3 {
	return new MockLanguageModelV3({
		doStream: () =>
			Promise.resolve({ stream: simulateReadableStream({ chunks }) }),
	});
}

function rejectingModel(message: string): LanguageModelV3 {
	return new MockLanguageModelV3({
		doStream: () => Promise.reject(new Error(message)),
	});
}

function fakeModelFactory(model: LanguageModelV3): ModelFactory {
	return { create: () => Promise.resolve(model) };
}

const HAPPY: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "Hello" },
	{ type: "text-delta", id: "0", delta: " world" },
	{ type: "text-end", id: "0" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: v3Usage(10, 5),
	},
];

const REASONING: LanguageModelV3StreamPart[] = [
	{ type: "reasoning-start", id: "r" },
	{ type: "reasoning-delta", id: "r", delta: "thinking" },
	{ type: "reasoning-end", id: "r" },
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "answer" },
	{ type: "text-end", id: "0" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: v3Usage(1, 1),
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
		composioAccountIds: [],
		tokenHash: "hash-runtime",
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
	});
	return { runtime, sessionStore, messageStore, session };
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

it("streams text and persists a complete assistant message", async () => {
	const { runtime, messageStore, session } = await setup(scriptedModel(HAPPY));
	const { events, final } = await collect(
		runtime.runTurn({ sessionId: session.id, text: "hi" })
	);
	expect(events.some((e) => e.type === "message-start")).toBe(true);
	const streamed = events
		.flatMap((e) => (e.type === "text-delta" ? [e.delta] : []))
		.join("");
	expect(streamed).toBe("Hello world");
	expect(events.find((e) => e.type === "done")).toEqual({
		type: "done",
		usage: {
			inputTokens: 10,
			outputTokens: 5,
			totalTokens: 15,
			reasoningTokens: null,
			cacheReadTokens: null,
			cacheWriteTokens: null,
			costCents: null,
		},
		finishReason: "stop",
		structured: null,
	});

	const history = await messageStore.listWithParts(session.id);
	expect(history.map((h) => h.message.role)).toEqual(["user", "assistant"]);
	expect(history[0]?.parts[0]?.content).toEqual({ text: "hi" });
	const assistant = history[1];
	expect(assistant?.message.status).toBe("complete");
	expect(assistant?.message.finishReason).toBe("stop");
	expect(assistant?.message.usage).toEqual({
		inputTokens: 10,
		outputTokens: 5,
		totalTokens: 15,
		reasoningTokens: null,
		cacheReadTokens: null,
		cacheWriteTokens: null,
		costCents: null,
	});
	expect(assistant?.parts[0]?.content).toEqual({ text: "Hello world" });
	expect(final.status).toBe("complete");
	expect(final.role).toBe("assistant");
});

it("persists reasoning and text as separate ordered parts", async () => {
	const { runtime, messageStore, session } = await setup(
		scriptedModel(REASONING)
	);
	const { events } = await collect(
		runtime.runTurn({ sessionId: session.id, text: "hi" })
	);
	expect(events.some((e) => e.type === "reasoning-delta")).toBe(true);
	const assistant = (await messageStore.listWithParts(session.id))[1];
	expect(assistant?.parts.map((p) => p.type)).toEqual(["reasoning", "text"]);
	expect(assistant?.parts[0]?.content).toEqual({ text: "thinking" });
	expect(assistant?.parts[1]?.content).toEqual({ text: "answer" });
});

it("marks the assistant and session as error when the model fails", async () => {
	const { runtime, sessionStore, messageStore, session } = await setup(
		rejectingModel("boom")
	);
	const { events, final } = await collect(
		runtime.runTurn({ sessionId: session.id, text: "hi" })
	);
	expect(events.some((e) => e.type === "error")).toBe(true);
	expect(final.status).toBe("error");
	expect((await sessionStore.get(session.id))?.status).toBe("error");
	const assistant = (await messageStore.listWithParts(session.id))[1];
	expect(assistant?.message.status).toBe("error");
});

it("resets a previously errored session back to active on a successful turn", async () => {
	const { runtime, sessionStore, session } = await setup(scriptedModel(HAPPY));
	await sessionStore.setStatus(session.id, "error");
	await collect(runtime.runTurn({ sessionId: session.id, text: "hi" }));
	expect((await sessionStore.get(session.id))?.status).toBe("active");
});

it("throws when the session does not exist", async () => {
	const { runtime } = await setup(scriptedModel(HAPPY));
	await expect(
		runtime.runTurn({ sessionId: "missing", text: "hi" }).next()
	).rejects.toThrow(NOT_FOUND_RE);
});

function hangingAfterTwoDeltas(): LanguageModelV3 {
	return new MockLanguageModelV3({
		doStream: () =>
			Promise.resolve({
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue({ type: "text-start", id: "0" });
						controller.enqueue({ type: "text-delta", id: "0", delta: "a" });
						controller.enqueue({ type: "text-delta", id: "0", delta: "b" });
						// never close → stream stays open
					},
				}),
			}),
	});
}

it("records an error category on a failed turn", async () => {
	const { runtime, messageStore, session } = await setup(
		rejectingModel("bad request")
	);
	const { final } = await collect(
		runtime.runTurn({ sessionId: session.id, text: "hi" })
	);
	expect(final.status).toBe("error");
	const assistant = (await messageStore.listWithParts(session.id))[1];
	expect(assistant?.message.error?.category).toBe("fatal");
});

it("yields text deltas incrementally without waiting for the stream to finish", async () => {
	const { runtime, session } = await setup(hangingAfterTwoDeltas());
	const gen = runtime.runTurn({ sessionId: session.id, text: "hi" });
	const events: RunEvent[] = [];
	for (let i = 0; i < 3; i++) {
		const next = await gen.next();
		if (next.done) {
			break;
		}
		events.push(next.value);
	}
	expect(events.some((e) => e.type === "message-start")).toBe(true);
	const deltas = events.flatMap((e) =>
		e.type === "text-delta" ? [e.delta] : []
	);
	expect(deltas).toEqual(["a", "b"]);
}, 5000);

it("persists the streamed part incrementally (created before flush)", async () => {
	const { runtime, session, messageStore } = await setup(scriptedModel(HAPPY));
	const gen = runtime.runTurn({ sessionId: session.id, text: "hi" });
	let sawStreamingPart = false;
	let next = await gen.next();
	while (!next.done) {
		if (next.value.type === "text-delta") {
			const groups = await messageStore.listWithParts(session.id);
			const parts = groups.flatMap((g) => g.parts);
			if (parts.some((p) => p.type === "text" && p.status === "streaming")) {
				sawStreamingPart = true;
			}
		}
		next = await gen.next();
	}
	expect(sawStreamingPart).toBe(true);
	// And after completion the assistant part is finalized.
	const finalGroups = await messageStore.listWithParts(session.id);
	const assistantParts = finalGroups.find(
		(g) => g.message.role === "assistant"
	)?.parts;
	const textPart = assistantParts?.find((p) => p.type === "text");
	expect(textPart?.status).toBe("complete");
	expect((textPart?.content as { text: string }).text).toBe("Hello world");
});

it("rejects a concurrent turn on the same session as busy", async () => {
	const { runtime, session } = await setup(scriptedModel(HAPPY));
	const first = runtime.runTurn({ sessionId: session.id, text: "hi" });
	await first.next(); // acquires the lock and starts streaming (lock held)
	const second = runtime.runTurn({ sessionId: session.id, text: "hi" });
	await expect(second.next()).rejects.toThrow(ALREADY_PROCESSING_RE);
	// Drain the first turn to release the lock, then a fresh turn succeeds.
	while (!(await first.next()).done) {
		// drain
	}
	const third = runtime.runTurn({ sessionId: session.id, text: "hi" });
	expect((await third.next()).done).toBe(false);
});
