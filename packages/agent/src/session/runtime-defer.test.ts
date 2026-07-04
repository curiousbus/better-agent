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
import { DEFER_THRESHOLD, SEARCH_TOOL_NAME } from "../tool/tool-search";
import type { ToolDef } from "../tool/types";
import { createSessionRuntime } from "./runtime";
import { createInMemorySessionLock } from "./session-lock";

const USAGE = {
	inputTokens: {
		total: 10,
		noCache: undefined,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 5, text: undefined, reasoning: undefined },
};

function deferredDef(name: string, description: string): ToolDef {
	return {
		name,
		description,
		defer: true,
		parameters: { type: "object" },
		execute: () => Promise.resolve({ output: `ran ${name}` }),
	};
}

function finish(reason: "tool-calls" | "stop"): LanguageModelV3StreamPart {
	return {
		type: "finish",
		finishReason: { unified: reason, raw: reason },
		usage: USAGE,
	};
}

function toolCallStep(
	toolName: string,
	input: Record<string, unknown>
): LanguageModelV3StreamPart[] {
	return [
		{
			type: "tool-call",
			toolCallId: `call-${toolName}`,
			toolName,
			input: JSON.stringify(input),
		},
		finish("tool-calls"),
	];
}

const TEXT_STEP: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "Sent." },
	{ type: "text-end", id: "0" },
	finish("stop"),
];

function scriptedModel(seenToolNames: string[][]) {
	const steps = [
		toolCallStep(SEARCH_TOOL_NAME, { queries: ["send email"] }),
		toolCallStep("GMAIL_SEND_EMAIL", {}),
		TEXT_STEP,
	];
	let call = 0;
	return new MockLanguageModelV3({
		doStream: (options) => {
			seenToolNames.push((options.tools ?? []).map((tool) => tool.name));
			const chunks = steps[call] ?? TEXT_STEP;
			call++;
			return Promise.resolve({ stream: simulateReadableStream({ chunks }) });
		},
	});
}

async function setupRuntime(model: MockLanguageModelV3) {
	const agentStore = createFakeAgentStore();
	const sessionStore = createFakeSessionStore();
	const agent = await agentStore.create({
		name: "Helper",
		description: "d",
		systemPrompt: "s",
		providerId: "openai",
		modelId: "gpt-x",
		params: null,
		composioAccountIds: [],
		mcpServerIds: [],
		builtinTools: [],
		tokenHash: "hash-defer",
	});
	const session = await sessionStore.create({ agentId: agent.id });
	const runtime = createSessionRuntime({
		sessionStore,
		messageStore: createFakeMessageStore(),
		agentStore,
		modelFactory: {
			create: () => Promise.resolve(model as LanguageModelV3),
		} as ModelFactory,
		sessionLock: createInMemorySessionLock(),
		modelCacheStore: createFakeModelStore(),
		providerCatalogStore: createFakeCatalogStore(),
		summarizer: createFakeSummarizer(),
	});
	return { runtime, session };
}

async function collectToolResults(
	gen: AsyncGenerator<{ type: string; result?: unknown }, unknown>
) {
	const toolResults: string[] = [];
	let next = await gen.next();
	while (!next.done) {
		if (next.value.type === "tool-result") {
			toolResults.push(String(next.value.result));
		}
		next = await gen.next();
	}
	return toolResults;
}

it("withholds deferred schemas until search_tools surfaces them", async () => {
	// Enough deferred tools to trip the threshold.
	const deferred = Array.from({ length: DEFER_THRESHOLD + 1 }, (_, i) =>
		deferredDef(`FILLER_TOOL_${i}`, "unrelated filler")
	);
	deferred.push(deferredDef("GMAIL_SEND_EMAIL", "Send an email via Gmail"));

	const seenToolNames: string[][] = [];
	const { runtime, session } = await setupRuntime(scriptedModel(seenToolNames));

	const toolResults = await collectToolResults(
		runtime.runTurn({
			sessionId: session.id,
			text: "send bob an email",
			tools: deferred,
		})
	);

	// Step 1: only the search tool is exposed — no deferred schemas sent.
	expect(seenToolNames[0]).toEqual([SEARCH_TOOL_NAME]);
	// Step 2: the searched-for tool is now exposed too.
	expect(seenToolNames[1]).toContain("GMAIL_SEND_EMAIL");
	expect(seenToolNames[1]).toContain(SEARCH_TOOL_NAME);
	// Irrelevant fillers stay hidden.
	expect(seenToolNames[1]).not.toContain("FILLER_TOOL_0");
	// The surfaced tool actually executed.
	expect(toolResults.some((r) => r.includes("ran GMAIL_SEND_EMAIL"))).toBe(
		true
	);
});

it("structured output NEVER defers, even with many tools", async () => {
	// A genui turn (outputSchema) on an agent with enough tools to trip the
	// threshold must NOT engage deferral: no search_tools, StructuredOutput
	// directly available, toolChoice forced. Otherwise the model chases tool
	// search instead of emitting the UI tree.
	const deferred = Array.from({ length: DEFER_THRESHOLD + 5 }, (_, i) =>
		deferredDef(`FILLER_TOOL_${i}`, "unrelated filler")
	);
	const seen: { choice: unknown; toolNames: string[] }[] = [];
	const model = new MockLanguageModelV3({
		doStream: (options) => {
			seen.push({
				choice: options.toolChoice,
				toolNames: (options.tools ?? []).map((tool) => tool.name),
			});
			return Promise.resolve({
				stream: simulateReadableStream({
					chunks: [
						{
							type: "tool-call",
							toolCallId: "so-1",
							toolName: "StructuredOutput",
							input: JSON.stringify({ ui: {} }),
						},
						finish("stop"),
					],
				}),
			});
		},
	});
	const { runtime, session } = await setupRuntime(model);
	await collectToolResults(
		runtime.runTurn({
			sessionId: session.id,
			text: "show me a card",
			tools: deferred,
			outputSchema: { type: "object" },
		})
	);
	expect(seen.length).toBeGreaterThan(0);
	const first = seen[0];
	// No search gateway; StructuredOutput is directly present; all fillers bound.
	expect(first?.toolNames).not.toContain(SEARCH_TOOL_NAME);
	expect(first?.toolNames).toContain("StructuredOutput");
	expect(first?.toolNames).toContain("FILLER_TOOL_0");
	expect((first?.choice as { type?: string })?.type).toBe("required");
});
