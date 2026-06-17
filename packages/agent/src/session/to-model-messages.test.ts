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

describe("toModelMessages", () => {
	it("prepends the system prompt then maps user/assistant turns", () => {
		const result = toModelMessages({
			systemPrompt: "You are helpful.",
			summary: null,
			compactedThroughSeq: null,
			history: [entry("user", 0, "hi"), entry("assistant", 1, "hello")],
		});
		expect(result).toEqual([
			{ role: "system", content: "You are helpful." },
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "hello" },
		]);
	});

	it("joins textual parts (text + reasoning) with newlines", () => {
		const result = toModelMessages({
			systemPrompt: "S",
			summary: null,
			compactedThroughSeq: null,
			history: [MULTI_PART_MSG],
		});
		expect(result[1]).toEqual({ role: "assistant", content: "line1\nline2" });
	});

	it("with a summary, prepends it and drops messages at or before compactedThroughSeq", () => {
		const result = toModelMessages({
			systemPrompt: "S",
			summary: "earlier talk",
			compactedThroughSeq: COMPACTED_SEQ,
			history: COMPACTION_HISTORY,
		});
		expect(result).toEqual([
			{ role: "system", content: "S" },
			{ role: "system", content: "对话摘要：earlier talk" },
			{ role: "user", content: "new" },
		]);
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
});
