import type { ModelMessage, ToolCallPart, ToolResultPart } from "ai";
import type { MessagePart, MessageWithParts } from "./types";

export interface ToModelMessagesInput {
	compactedThroughSeq: number | null;
	/** 按 seq 升序的会话历史。 */
	history: MessageWithParts[];
	/** 📐 P2 compaction：非 null 时前置摘要并只纳入 seq > compactedThroughSeq 的消息。 */
	summary: string | null;
	systemPrompt: string;
}

const NO_COMPACTION = -1;

/** 拼接 text parts 为字符串（忽略 reasoning 与 tool-* parts）。历史 reasoning
 * 是模型的临时思考，回放会污染上下文并浪费 token，故不喂回。 */
function joinTextParts(parts: MessagePart[]): string {
	const texts: string[] = [];
	for (const part of parts) {
		if (part.type === "text") {
			texts.push(part.content.text);
		}
	}
	return texts.join("\n");
}

/** 扫描全部历史，建立 callId → toolName 全局映射。 */
function buildGlobalCallIdMap(
	history: MessageWithParts[]
): Map<string, string> {
	const map = new Map<string, string>();
	for (const entry of history) {
		for (const part of entry.parts) {
			if (part.type === "tool-call") {
				map.set(part.content.callId, part.content.toolName);
			}
		}
	}
	return map;
}

/** 从单个 MessagePart 构建 ToolCallPart（AI-SDK shape）。 */
function toSdkToolCallPart(
	part: MessagePart & { type: "tool-call" }
): ToolCallPart {
	return {
		type: "tool-call",
		toolCallId: part.content.callId,
		toolName: part.content.toolName,
		input: part.content.args,
	};
}

/** 从单个 MessagePart 构建 ToolResultPart（AI-SDK shape）。 */
function toSdkToolResultPart(
	part: MessagePart & { type: "tool-result" },
	callIdToTool: Map<string, string>
): ToolResultPart {
	const toolName = callIdToTool.get(part.content.callId) ?? part.content.callId;
	return {
		type: "tool-result",
		toolCallId: part.content.callId,
		toolName,
		output: { type: "text", value: String(part.content.result) },
	};
}

interface CollectedToolParts {
	assistantContent: Array<{ type: "text"; text: string } | ToolCallPart>;
	toolMessages: ModelMessage[];
}

/** 遍历 parts，分别收集 assistant content 和 tool-result 消息。 */
function collectToolParts(
	parts: MessagePart[],
	callIdToTool: Map<string, string>
): CollectedToolParts {
	const assistantContent: Array<{ type: "text"; text: string } | ToolCallPart> =
		[];
	const toolMessages: ModelMessage[] = [];

	for (const part of parts) {
		if (part.type === "text") {
			if (part.content.text.length > 0) {
				assistantContent.push({ type: "text", text: part.content.text });
			}
		} else if (part.type === "tool-call") {
			assistantContent.push(toSdkToolCallPart(part));
		} else if (part.type === "tool-result") {
			const resultPart = toSdkToolResultPart(part, callIdToTool);
			toolMessages.push({ role: "tool", content: [resultPart] });
		}
	}

	return { assistantContent, toolMessages };
}

/** 渲染一个 assistant entry，返回一或多条 ModelMessage。 */
function renderAssistantEntry(
	entry: MessageWithParts,
	callIdToTool: Map<string, string>
): ModelMessage[] {
	const hasTool = entry.parts.some(
		(p) => p.type === "tool-call" || p.type === "tool-result"
	);

	if (!hasTool) {
		return [{ role: "assistant", content: joinTextParts(entry.parts) }];
	}

	const { assistantContent, toolMessages } = collectToolParts(
		entry.parts,
		callIdToTool
	);

	const messages: ModelMessage[] = [];
	if (assistantContent.length > 0) {
		messages.push({ role: "assistant", content: assistantContent });
	}
	for (const tm of toolMessages) {
		messages.push(tm);
	}
	return messages;
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

	// Build global callId → toolName map from full (unfiltered) history
	// so tool-result entries can always find their toolName.
	const callIdToTool = buildGlobalCallIdMap(input.history);

	for (const entry of history) {
		if (entry.message.role === "user") {
			result.push({ role: "user", content: joinTextParts(entry.parts) });
		} else if (entry.message.role === "assistant") {
			for (const msg of renderAssistantEntry(entry, callIdToTool)) {
				result.push(msg);
			}
		}
		// 历史里的 system 消息跳过：systemPrompt 已在最前，摘要单独处理。
	}
	return result;
}
