import type { ModelMessage } from "ai";
import type { MessageWithParts } from "./types";

export interface ToModelMessagesInput {
	compactedThroughSeq: number | null;
	/** 按 seq 升序的会话历史。 */
	history: MessageWithParts[];
	/** 📐 P2 compaction：非 null 时前置摘要并只纳入 seq > compactedThroughSeq 的消息。 */
	summary: string | null;
	systemPrompt: string;
}

const NO_COMPACTION = -1;

/** 拼接一条消息的 text/reasoning parts 文本；tool-* parts 本期忽略。 */
function toTextContent(entry: MessageWithParts): string {
	const texts: string[] = [];
	for (const part of entry.parts) {
		if (part.type === "text" || part.type === "reasoning") {
			texts.push(part.content.text);
		}
	}
	return texts.join("\n");
}

export function toModelMessages(input: ToModelMessagesInput): ModelMessage[] {
	const result: ModelMessage[] = [
		{ role: "system", content: input.systemPrompt },
	];

	let history = input.history;
	if (input.summary !== null) {
		result.push({ role: "system", content: `对话摘要：${input.summary}` });
		const through = input.compactedThroughSeq ?? NO_COMPACTION;
		history = history.filter((entry) => entry.message.seq > through);
	}

	for (const entry of history) {
		const content = toTextContent(entry);
		if (entry.message.role === "user") {
			result.push({ role: "user", content });
		} else if (entry.message.role === "assistant") {
			result.push({ role: "assistant", content });
		}
		// 历史里的 system 消息跳过：systemPrompt 已在最前，摘要单独处理。
	}
	return result;
}
