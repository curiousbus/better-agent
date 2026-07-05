// opencode: `opencode acp` — the Agent Client Protocol (ACP,
// https://agentclientprotocol.com) server built into the opencode CLI,
// speaking newline-delimited JSON-RPC over stdio. We only need the
// `session/update` notification stream here; requests (`initialize`,
// `session/new`, `session/prompt`) are issued by the adapter, not mapped here.

import {
	type ApprovalEvent,
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

// --- Approval requests ------------------------------------------------------
//
// ASSUMPTION (unverified — no `opencode` binary is available in this
// sandbox; shape per the ACP spec, https://agentclientprotocol.com/protocol/schema,
// `RequestPermissionRequest`/`PermissionOption`): the request's `params.options`
// is an array of `{ optionId, name, kind }`, and the reply selects one via
// `{ outcome: { outcome: "selected", optionId } }`. Reverify against the
// installed opencode version before relying on this.

const APPROVAL_METHOD = "session/request_permission";

interface AcpPermissionOption {
	name: string;
	optionId: string;
}

function isAcpPermissionOption(value: unknown): value is AcpPermissionOption {
	return (
		isRecord(value) &&
		typeof value.optionId === "string" &&
		typeof value.name === "string"
	);
}

function acpApprovalDetail(
	toolCall: Record<string, unknown>
): string | undefined {
	return toolCall.rawInput === undefined
		? undefined
		: JSON.stringify(toolCall.rawInput);
}

/**
 * Maps an ACP `session/request_permission` server-initiated *request* — an
 * `onRequest`-surfaced `(id, method, params)`, not an `onNotification` one —
 * to an `ApprovalEvent`, or `[]` if `method`/`params` don't match.
 */
export function normalizeOpencodeApprovalRequest(
	requestId: string,
	method: string,
	params: unknown
): ApprovalEvent[] {
	if (method !== APPROVAL_METHOD || !isRecord(params)) {
		return [];
	}
	const options = Array.isArray(params.options)
		? params.options.filter(isAcpPermissionOption)
		: [];
	if (options.length === 0) {
		return [];
	}
	const toolCall = isRecord(params.toolCall) ? params.toolCall : {};
	return [
		{
			detail: acpApprovalDetail(toolCall),
			kind: "approval",
			options: options.map((option) => ({
				id: option.optionId,
				label: option.name,
			})),
			requestId,
			title: asString(toolCall.title) ?? "Approve action?",
		},
	];
}
