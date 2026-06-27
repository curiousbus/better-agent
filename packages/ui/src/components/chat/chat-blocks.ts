import type { MessageHistory } from "@curiousbus/agent-client";

type SessionMessageRow = MessageHistory[number];

export interface ToolInvocation {
	args: unknown;
	callId: string;
	isError: boolean;
	result?: unknown;
	status: "running" | "complete" | "error";
	toolName: string;
}

/** One ordered piece of an assistant turn, in the order the agent produced it. */
export type ChatBlock =
	| { kind: "text"; text: string }
	| { kind: "reasoning"; text: string }
	| { kind: "tool"; tool: ToolInvocation };

export interface ChatMessage {
	blocks: ChatBlock[];
	errorText?: string;
	id: string;
	role: "user" | "assistant" | "system";
	status: "complete" | "streaming" | "error";
}

function partStatus(status: SessionMessageRow["message"]["status"]) {
	if (status === "complete") {
		return "complete" as const;
	}
	if (status === "error") {
		return "error" as const;
	}
	if (status === "aborted") {
		return "complete" as const;
	}
	return "streaming" as const;
}

/** Append text to the trailing block if it's the same kind, else start a new one. */
export function appendText(
	blocks: ChatBlock[],
	kind: "text" | "reasoning",
	text: string
) {
	const last = blocks.at(-1);
	if (last && last.kind === kind) {
		last.text += text;
	} else {
		blocks.push({ kind, text });
	}
}

/** Build the ordered blocks for a persisted message (parts are seq-ordered). */
function buildBlocks(parts: SessionMessageRow["parts"]): ChatBlock[] {
	const blocks: ChatBlock[] = [];
	const toolByCallId = new Map<string, ToolInvocation>();
	for (const part of parts) {
		if (part.type === "text") {
			appendText(blocks, "text", part.content.text);
		} else if (part.type === "reasoning") {
			appendText(blocks, "reasoning", part.content.text);
		} else if (part.type === "tool-call") {
			const tool: ToolInvocation = {
				callId: part.content.callId,
				toolName: part.content.toolName,
				args: part.content.args,
				isError: false,
				status: "running",
			};
			blocks.push({ kind: "tool", tool });
			toolByCallId.set(part.content.callId, tool);
		} else if (part.type === "tool-result") {
			const tool = toolByCallId.get(part.content.callId);
			if (tool) {
				tool.result = part.content.result;
				tool.isError = part.content.isError;
				tool.status = part.content.isError ? "error" : "complete";
			}
		}
	}
	return blocks;
}

export function toChatMessage(entry: SessionMessageRow): ChatMessage {
	return {
		id: entry.message.id,
		role: entry.message.role,
		status: partStatus(entry.message.status),
		blocks: buildBlocks(entry.parts),
	};
}

/** Concatenate the text blocks of a message (for copy / user display). */
export function messageText(message: ChatMessage): string {
	return message.blocks
		.filter((b): b is { kind: "text"; text: string } => b.kind === "text")
		.map((b) => b.text)
		.join("");
}
