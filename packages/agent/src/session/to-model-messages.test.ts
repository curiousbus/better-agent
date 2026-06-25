import { describe, expect, it } from "vitest";
import { toModelMessages } from "./to-model-messages";
import type { MessageWithParts } from "./types";

const NOW = new Date("2026-06-16T00:00:00Z");

function entry(
	role: "user" | "assistant" | "system",
	seq: number,
	text: string
): MessageWithParts {
	return {
		message: {
			id: `msg-${seq}`,
			sessionId: "s",
			role,
			seq,
			status: "complete",
			providerId: null,
			modelId: null,
			usage: null,
			finishReason: null,
			error: null,
			createdAt: NOW,
			updatedAt: NOW,
		},
		parts: [
			{
				id: `part-${seq}`,
				messageId: `msg-${seq}`,
				seq: 0,
				type: "text",
				content: { text },
				status: "complete",
				createdAt: NOW,
				updatedAt: NOW,
			},
		],
	};
}

const MULTI_PART_MSG: MessageWithParts = {
	message: entry("assistant", 0, "").message,
	parts: [
		{
			id: "p0",
			messageId: "msg-0",
			seq: 0,
			type: "reasoning",
			content: { text: "line1" },
			status: "complete",
			createdAt: NOW,
			updatedAt: NOW,
		},
		{
			id: "p1",
			messageId: "msg-0",
			seq: 1,
			type: "text",
			content: { text: "line2" },
			status: "complete",
			createdAt: NOW,
			updatedAt: NOW,
		},
	],
};

const COMPACTED_SEQ = 1;
const COMPACTION_HISTORY = [
	entry("user", 0, "old"),
	entry("assistant", COMPACTED_SEQ, "older"),
	entry("user", COMPACTED_SEQ + 1, "new"),
];

const BASIC_HISTORY = [entry("user", 0, "hi"), entry("assistant", 1, "hello")];
const BASIC_EXPECTED = [
	{ role: "system", content: "You are helpful." },
	{ role: "user", content: "hi" },
	{ role: "assistant", content: "hello" },
];

const COMPACTION_EXPECTED = [
	{ role: "system", content: "S" },
	{ role: "system", content: "对话摘要：earlier talk" },
	{ role: "user", content: "new" },
];

const SUMMARY_NO_COMPACTION_HISTORY = [
	entry("user", 0, "a"),
	entry("assistant", 1, "b"),
];
const SUMMARY_NO_COMPACTION_EXPECTED = [
	{ role: "system", content: "S" },
	{ role: "system", content: "对话摘要：all prior talk" },
	{ role: "user", content: "a" },
	{ role: "assistant", content: "b" },
];

const TOOL_CALL_ID = "call-abc-123";
const TOOL_NAME = "calculator";
const TOOL_ARGS = { expression: "2+2" };
const TOOL_RESULT_VALUE = "4";

const TOOL_CALL_ENTRY: MessageWithParts = {
	message: {
		id: "msg-tc",
		sessionId: "s",
		role: "assistant",
		seq: 0,
		status: "complete",
		providerId: null,
		modelId: null,
		usage: null,
		finishReason: null,
		error: null,
		createdAt: NOW,
		updatedAt: NOW,
	},
	parts: [
		{
			id: "p-text",
			messageId: "msg-tc",
			seq: 0,
			type: "text",
			content: { text: "Let me calculate that." },
			status: "complete",
			createdAt: NOW,
			updatedAt: NOW,
		},
		{
			id: "p-call",
			messageId: "msg-tc",
			seq: 1,
			type: "tool-call",
			content: { callId: TOOL_CALL_ID, toolName: TOOL_NAME, args: TOOL_ARGS },
			status: "complete",
			createdAt: NOW,
			updatedAt: NOW,
		},
	],
};

const TOOL_RESULT_ENTRY: MessageWithParts = {
	message: {
		id: "msg-tr",
		sessionId: "s",
		role: "assistant",
		seq: 1,
		status: "complete",
		providerId: null,
		modelId: null,
		usage: null,
		finishReason: null,
		error: null,
		createdAt: NOW,
		updatedAt: NOW,
	},
	parts: [
		{
			id: "p-result",
			messageId: "msg-tr",
			seq: 0,
			type: "tool-result",
			content: {
				callId: TOOL_CALL_ID,
				isError: false,
				result: TOOL_RESULT_VALUE,
			},
			status: "complete",
			createdAt: NOW,
			updatedAt: NOW,
		},
	],
};

type ContentArray = Array<{ type: string; toolCallId?: string }>;

function assertToolReplayMessages(
	result: ReturnType<typeof toModelMessages>
): void {
	expect(result[0]).toEqual({ role: "system", content: "S" });
	expect(result[1]).toEqual({
		role: "assistant",
		content: [
			{ type: "text", text: "Let me calculate that." },
			{
				type: "tool-call",
				toolCallId: TOOL_CALL_ID,
				toolName: TOOL_NAME,
				input: TOOL_ARGS,
			},
		],
	});
	expect(result[2]).toEqual({
		role: "tool",
		content: [
			{
				type: "tool-result",
				toolCallId: TOOL_CALL_ID,
				toolName: TOOL_NAME,
				output: { type: "text", value: TOOL_RESULT_VALUE },
			},
		],
	});
}

function assertToolCallIdMatch(
	result: ReturnType<typeof toModelMessages>
): void {
	const assistantMsg = result[1] as { role: string; content: ContentArray };
	const toolMsg = result[2] as { role: string; content: ContentArray };
	const callPart = assistantMsg.content.find((p) => p.type === "tool-call");
	const resultPart = toolMsg.content[0] as
		| { type: string; toolCallId: string }
		| undefined;
	expect(callPart?.toolCallId).toBe(resultPart?.toolCallId);
}

describe("toModelMessages — tool replay", () => {
	it("replays tool-call and tool-result parts as paired model messages", () => {
		const result = toModelMessages({
			systemPrompt: "S",
			summary: null,
			compactedThroughSeq: null,
			history: [TOOL_CALL_ENTRY, TOOL_RESULT_ENTRY],
		});
		assertToolReplayMessages(result);
		assertToolCallIdMatch(result);
	});
});

describe("toModelMessages — text and compaction", () => {
	it("prepends the system prompt then maps user/assistant turns", () => {
		const result = toModelMessages({
			systemPrompt: "You are helpful.",
			summary: null,
			compactedThroughSeq: null,
			history: BASIC_HISTORY,
		});
		expect(result).toEqual(BASIC_EXPECTED);
	});

	it("replays only text parts, excluding reasoning", () => {
		const result = toModelMessages({
			systemPrompt: "S",
			summary: null,
			compactedThroughSeq: null,
			history: [MULTI_PART_MSG],
		});
		expect(result[1]).toEqual({ role: "assistant", content: "line2" });
	});

	it("with a summary, prepends it and drops messages at or before compactedThroughSeq", () => {
		const result = toModelMessages({
			systemPrompt: "S",
			summary: "earlier talk",
			compactedThroughSeq: COMPACTED_SEQ,
			history: COMPACTION_HISTORY,
		});
		expect(result).toEqual(COMPACTION_EXPECTED);
	});

	it("skips system messages found in history", () => {
		const result = toModelMessages({
			systemPrompt: "S",
			summary: null,
			compactedThroughSeq: null,
			history: [entry("system", 0, "ignored"), entry("user", 1, "hi")],
		});
		expect(result).toEqual([
			{ role: "system", content: "S" },
			{ role: "user", content: "hi" },
		]);
	});

	it("with a summary and no compactedThroughSeq, keeps all history messages", () => {
		const result = toModelMessages({
			systemPrompt: "S",
			summary: "all prior talk",
			compactedThroughSeq: null,
			history: SUMMARY_NO_COMPACTION_HISTORY,
		});
		expect(result).toEqual(SUMMARY_NO_COMPACTION_EXPECTED);
	});
});
