import { expect, it } from "vitest";
import type { AgentConfig } from "../agent/types";
import { createFakeSummarizer } from "../testing/fakes";
import { compactSession, selectCompactionBoundary } from "./compaction";
import type { MessageWithParts, Session } from "./types";

function entry(
	seq: number,
	role: "user" | "assistant",
	text: string
): MessageWithParts {
	const now = new Date();
	return {
		message: {
			id: `m${seq}`,
			sessionId: "s1",
			role,
			seq,
			status: "complete",
			providerId: null,
			modelId: null,
			usage: null,
			finishReason: null,
			error: null,
			createdAt: now,
			updatedAt: now,
		},
		parts: [
			{
				id: `p${seq}`,
				messageId: `m${seq}`,
				seq: 0,
				type: "text",
				content: { text },
				status: "complete",
				createdAt: now,
				updatedAt: now,
			},
		],
	};
}

const AGENT = {
	id: "a1",
	providerId: "openai",
	modelId: "gpt-x",
} as AgentConfig;
const SESSION = {
	id: "s1",
	summary: null,
	compactedThroughSeq: null,
} as Session;

it("selectCompactionBoundary keeps the last K and returns the boundary seq", () => {
	const history = [0, 1, 2, 3].map((n) => entry(n, "user", "x"));
	// keepRecent 2 → keep seq 2,3 → boundary is seq 1
	expect(selectCompactionBoundary(history, 2)).toBe(1);
});

it("selectCompactionBoundary returns null when there is nothing to compact", () => {
	const history = [0, 1].map((n) => entry(n, "user", "x"));
	expect(selectCompactionBoundary(history, 2)).toBeNull();
});

it("compactSession summarizes older messages and persists summary + boundary", async () => {
	const summarizer = createFakeSummarizer("SUMMARY");
	const calls: { boundary: number; summary: string }[] = [];
	const sessionStore = {
		setSummary: (_id: string, summary: string, boundary: number) => {
			calls.push({ summary, boundary });
			return Promise.resolve();
		},
	} as never;
	const history = [0, 1, 2, 3, 4, 5, 6, 7].map((n) =>
		entry(n, "user", `m${n}`)
	);
	const result = await compactSession(
		{ summarizer, sessionStore },
		{ sessionId: "s1", agent: AGENT, session: SESSION, history }
	);
	// KEEP_RECENT_MESSAGES=6 → keep seq 2..7 → boundary 1
	expect(result).toEqual({ summary: "SUMMARY", boundary: 1 });
	expect(calls).toEqual([{ summary: "SUMMARY", boundary: 1 }]);
	expect(summarizer.calls[0]?.providerId).toBe("openai");
	expect(summarizer.calls[0]?.prompt).toContain("m0");
});

it("compactSession returns null (no summarizer call) when history is short", async () => {
	const summarizer = createFakeSummarizer("SUMMARY");
	const sessionStore = { setSummary: () => Promise.resolve() } as never;
	const history = [0, 1].map((n) => entry(n, "user", "x"));
	const result = await compactSession(
		{ summarizer, sessionStore },
		{ sessionId: "s1", agent: AGENT, session: SESSION, history }
	);
	expect(result).toBeNull();
	expect(summarizer.calls).toHaveLength(0);
});
