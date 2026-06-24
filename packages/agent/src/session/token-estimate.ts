import type { ModelMessage } from "ai";

const CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 4;
export const COMPACT_THRESHOLD = 0.8;

function contentLength(content: ModelMessage["content"]): number {
	if (typeof content === "string") {
		return content.length;
	}
	return JSON.stringify(content).length;
}

export function estimateTokens(messages: ModelMessage[]): number {
	let total = 0;
	for (const message of messages) {
		total +=
			Math.ceil(contentLength(message.content) / CHARS_PER_TOKEN) +
			MESSAGE_OVERHEAD_TOKENS;
	}
	return total;
}

export function exceedsContext(
	estimatedTokens: number,
	contextLimit: number | null
): boolean {
	if (contextLimit === null) {
		return false;
	}
	return estimatedTokens > contextLimit * COMPACT_THRESHOLD;
}
