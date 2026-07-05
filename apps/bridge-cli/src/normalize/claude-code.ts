// claude-code: `claude -p --output-format stream-json --input-format stream-json --verbose`.
// See https://code.claude.com/docs/en/headless for the documented envelope
// shapes (system/init, system/api_retry, assistant, user, result,
// stream_event). Confirm against the installed `claude` version if its
// stream-json output ever changes shape.

import {
	type ApprovalEvent,
	asString,
	isRecord,
	NO_EVENTS,
	type NormalizedEvent,
} from "./types";

function normalizeTextBlock(
	role: "user" | "assistant",
	block: Record<string, unknown>
): NormalizedEvent[] {
	const text = asString(block.text);
	return text === undefined ? NO_EVENTS : [{ kind: "message", role, text }];
}

function normalizeThinkingBlock(
	role: "user" | "assistant",
	block: Record<string, unknown>
): NormalizedEvent[] {
	const text = asString(block.thinking);
	return text === undefined
		? NO_EVENTS
		: [{ kind: "message", role, text, thinking: true }];
}

function normalizeToolUseBlock(
	block: Record<string, unknown>
): NormalizedEvent[] {
	const id = asString(block.id);
	const name = asString(block.name);
	return id === undefined || name === undefined
		? NO_EVENTS
		: [{ kind: "tool", id, name, status: "started", input: block.input }];
}

function normalizeToolResultBlock(
	block: Record<string, unknown>
): NormalizedEvent[] {
	const id = asString(block.tool_use_id);
	if (id === undefined) {
		return NO_EVENTS;
	}
	return [
		{
			kind: "tool",
			id,
			name: id,
			status: block.is_error ? "failed" : "completed",
			output: block.content,
		},
	];
}

function normalizeClaudeContentBlock(
	role: "user" | "assistant",
	block: unknown
): NormalizedEvent[] {
	if (!isRecord(block) || typeof block.type !== "string") {
		return NO_EVENTS;
	}
	switch (block.type) {
		case "text":
			return normalizeTextBlock(role, block);
		case "thinking":
			return normalizeThinkingBlock(role, block);
		case "tool_use":
			return normalizeToolUseBlock(block);
		case "tool_result":
			return normalizeToolResultBlock(block);
		default:
			return NO_EVENTS;
	}
}

function normalizeClaudeMessage(
	raw: Record<string, unknown>,
	role: "user" | "assistant"
): NormalizedEvent[] {
	const message = raw.message;
	if (typeof message === "string") {
		return [{ kind: "message", role, text: message }];
	}
	if (!isRecord(message)) {
		return NO_EVENTS;
	}
	const content = message.content;
	if (typeof content === "string") {
		return [{ kind: "message", role, text: content }];
	}
	if (!Array.isArray(content)) {
		return NO_EVENTS;
	}
	return content.flatMap((block) => normalizeClaudeContentBlock(role, block));
}

function normalizeClaudeSystem(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	const subtype = asString(raw.subtype) ?? "unknown";
	return [{ kind: "status", status: `system:${subtype}`, detail: raw }];
}

function normalizeClaudeResult(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	const subtype = asString(raw.subtype) ?? "unknown";
	return [{ kind: "status", status: `result:${subtype}`, detail: raw }];
}

function normalizeClaudeStreamEvent(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	const event = raw.event;
	if (!isRecord(event)) {
		return NO_EVENTS;
	}
	const delta = event.delta;
	if (isRecord(delta) && delta.type === "text_delta") {
		const text = asString(delta.text);
		return text === undefined ? NO_EVENTS : [{ kind: "output", text }];
	}
	return [{ kind: "status", status: "stream_event", detail: event }];
}

/**
 * True for claude's `{type:"system", subtype:"init"}` readiness line. The
 * stream-json input mode is a handshake: claude emits this once it can accept
 * user frames, and SILENTLY DROPS any frame written before it — so the adapter
 * buffers sends until this line arrives.
 */
export function isClaudeInitLine(raw: unknown): boolean {
	return isRecord(raw) && raw.type === "system" && raw.subtype === "init";
}

/** Maps one parsed line of `claude`'s stream-json stdout to normalized events. */
export function normalizeClaudeCode(raw: unknown): NormalizedEvent[] {
	if (!isRecord(raw)) {
		return NO_EVENTS;
	}
	switch (raw.type) {
		case "system":
			return normalizeClaudeSystem(raw);
		case "assistant":
			return normalizeClaudeMessage(raw, "assistant");
		case "user":
			return normalizeClaudeMessage(raw, "user");
		case "result":
			return normalizeClaudeResult(raw);
		case "stream_event":
			return normalizeClaudeStreamEvent(raw);
		default:
			return NO_EVENTS;
	}
}

/**
 * Builds one `claude --input-format stream-json` stdin frame for a follow-up
 * user turn. The exact frame shape isn't published for this direction (see
 * https://github.com/anthropics/claude-code/issues/24594) — this mirrors the
 * documented output shape for a plain-text user message and should be
 * reverified against the installed `claude` binary before relying on it.
 */
export function buildClaudeInputFrame(text: string): string {
	return JSON.stringify({
		type: "user",
		message: { role: "user", content: [{ type: "text", text }] },
	});
}

// --- Approval requests ------------------------------------------------------
//
// ASSUMPTION (unverified — no documented spec for this direction; shape
// reverse-engineered from third-party Claude Agent SDK write-ups describing
// the `--permission-prompt-tool stdio` control protocol, e.g.
// https://github.com/Roasbeef/claude-agent-sdk-go/blob/main/docs/cli-protocol.md):
// the CLI asks permission to use a tool via
// `{"type":"control_request","request_id":"...","request":{"subtype":
// "can_use_tool","tool_name":"...","input":{...}}}` on stdout, and expects a
// `{"type":"control_response","request_id":"...","response":{"subtype":
// "success","response":{"behavior":"allow"|"deny"}}}` reply on stdin.
// Reverify both frame shapes against the installed `claude` version before
// relying on this — some sources describe `request_id`/`response` nested
// one level deeper (under `request`/`response`), which is not what's
// implemented here.

const CAN_USE_TOOL_SUBTYPE = "can_use_tool";

/** The only two behaviors `answerApproval` can currently produce for
 * claude-code; option ids are the literal `behavior` values so no mapping
 * step is needed when building the reply frame. */
const CLAUDE_APPROVAL_OPTIONS = [
	{ id: "allow", label: "Allow" },
	{ id: "deny", label: "Deny" },
];

/**
 * Maps one parsed line of `claude`'s stdout to an `ApprovalEvent` if it's a
 * `can_use_tool` control request, or `[]` otherwise (an ordinary stream-json
 * envelope, unparseable JSON, or a control request of some other subtype).
 */
export function normalizeClaudeControlRequest(raw: unknown): ApprovalEvent[] {
	if (!isRecord(raw) || raw.type !== "control_request") {
		return [];
	}
	const requestId = asString(raw.request_id);
	const request = raw.request;
	if (
		requestId === undefined ||
		!isRecord(request) ||
		request.subtype !== CAN_USE_TOOL_SUBTYPE
	) {
		return [];
	}
	const toolName = asString(request.tool_name) ?? "a tool";
	return [
		{
			detail:
				request.input === undefined ? undefined : JSON.stringify(request.input),
			kind: "approval",
			options: CLAUDE_APPROVAL_OPTIONS,
			requestId,
			title: `Use ${toolName}?`,
		},
	];
}

/** Builds the `control_response` stdin frame answering a `can_use_tool`
 * request (see the ASSUMPTION above). */
export function buildClaudeControlResponse(
	requestId: string,
	behavior: string
): string {
	return JSON.stringify({
		type: "control_response",
		request_id: requestId,
		response: { subtype: "success", response: { behavior } },
	});
}
