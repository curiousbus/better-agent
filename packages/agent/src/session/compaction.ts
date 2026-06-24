import type { AgentConfig } from "../agent/types";
import type { SessionStore } from "../ports";
import type { MessageWithParts, Session } from "./types";

export const KEEP_RECENT_MESSAGES = 6;
const NO_COMPACTION = -1;

export interface Summarizer {
	summarize(input: {
		providerId: string;
		modelId: string;
		prompt: string;
	}): Promise<string>;
}

/** Seq of the last message to summarize (everything ≤ it is summarized, > it kept). */
export function selectCompactionBoundary(
	history: MessageWithParts[],
	keepRecent: number
): number | null {
	if (history.length <= keepRecent) {
		return null;
	}
	return history.at(-(keepRecent + 1))?.message.seq ?? null;
}

function renderMessage(entry: MessageWithParts): string {
	const text = entry.parts
		.filter((part) => part.type === "text" || part.type === "reasoning")
		.map((part) => (part.content as { text: string }).text)
		.join("\n");
	return `${entry.message.role}: ${text}`;
}

export function buildSummaryPrompt(
	priorSummary: string | null,
	toSummarize: MessageWithParts[]
): string {
	const lines: string[] = [];
	if (priorSummary !== null) {
		lines.push(`Summary so far:\n${priorSummary}`, "");
	}
	lines.push("Conversation to fold into the summary:");
	for (const entry of toSummarize) {
		lines.push(renderMessage(entry));
	}
	return lines.join("\n");
}

export async function compactSession(
	deps: { summarizer: Summarizer; sessionStore: SessionStore },
	input: {
		sessionId: string;
		agent: AgentConfig;
		session: Session;
		history: MessageWithParts[];
	}
): Promise<{ summary: string; boundary: number } | null> {
	const boundary = selectCompactionBoundary(
		input.history,
		KEEP_RECENT_MESSAGES
	);
	if (boundary === null) {
		return null;
	}
	const prevCompacted = input.session.compactedThroughSeq ?? NO_COMPACTION;
	const toSummarize = input.history.filter(
		(entry) =>
			entry.message.seq > prevCompacted && entry.message.seq <= boundary
	);
	if (toSummarize.length === 0) {
		return null;
	}
	const prompt = buildSummaryPrompt(input.session.summary, toSummarize);
	const summary = await deps.summarizer.summarize({
		providerId: input.agent.providerId,
		modelId: input.agent.modelId,
		prompt,
	});
	await deps.sessionStore.setSummary(input.sessionId, summary, boundary);
	return { summary, boundary };
}
