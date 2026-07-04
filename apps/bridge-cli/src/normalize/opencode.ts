// opencode: `opencode acp` — the Agent Client Protocol (ACP,
// https://agentclientprotocol.com) server built into the opencode CLI,
// speaking newline-delimited JSON-RPC over stdio. We only need the
// `session/update` notification stream here; requests (`initialize`,
// `session/new`, `session/prompt`) are issued by the adapter, not mapped here.

import {
	asString,
	isRecord,
	NO_EVENTS,
	type NormalizedEvent,
	type ToolEvent,
} from "./types";

interface AcpTextContent {
	text: string;
	type: "text";
}

function isAcpTextContent(value: unknown): value is AcpTextContent {
	return (
		isRecord(value) && value.type === "text" && typeof value.text === "string"
	);
}

function normalizeAcpToolCall(
	update: Record<string, unknown>,
	fallbackStatus: ToolEvent["status"]
): NormalizedEvent[] {
	const id = asString(update.toolCallId);
	if (id === undefined) {
		return NO_EVENTS;
	}
	const status =
		update.status === "completed" || update.status === "failed"
			? update.status
			: fallbackStatus;
	return [
		{
			kind: "tool",
			id,
			name: asString(update.title) ?? id,
			status,
			input: update.rawInput,
			output: update.content,
		},
	];
}

/** Maps one ACP `session/update` notification's `update` payload. */
function normalizeAcpUpdate(update: unknown): NormalizedEvent[] {
	if (!isRecord(update) || typeof update.sessionUpdate !== "string") {
		return NO_EVENTS;
	}
	switch (update.sessionUpdate) {
		case "agent_message_chunk":
		case "agent_thought_chunk": {
			if (!isAcpTextContent(update.content)) {
				return NO_EVENTS;
			}
			return [
				{
					kind: "message",
					role: "assistant",
					text: update.content.text,
					thinking: update.sessionUpdate === "agent_thought_chunk",
				},
			];
		}
		case "tool_call":
			return normalizeAcpToolCall(update, "started");
		case "tool_call_update":
			return normalizeAcpToolCall(update, "completed");
		case "plan":
			return [{ kind: "status", status: "plan", detail: update.entries }];
		default:
			return [{ kind: "status", status: update.sessionUpdate, detail: update }];
	}
}

/** Maps one parsed line of `opencode acp`'s stdout (JSON-RPC over stdio). */
export function normalizeOpencode(raw: unknown): NormalizedEvent[] {
	if (!isRecord(raw) || raw.method !== "session/update") {
		return NO_EVENTS;
	}
	const params = raw.params;
	return isRecord(params) ? normalizeAcpUpdate(params.update) : NO_EVENTS;
}
