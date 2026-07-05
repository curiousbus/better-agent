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
	// Drop empty/whitespace-only reasoning — an empty "thinking" bubble is worse
	// than none (the SDK emits a placeholder thinking block before content).
	return text && text.trim() !== ""
		? [{ kind: "message", role, text, thinking: true }]
		: NO_EVENTS;
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
			// Assistant response text now streams live via `stream_event`
			// `text_delta` output (see normalizeClaudeStreamEvent below); the
			// final assistant message's text block repeats that same text, so
			// it's dropped here to avoid double-rendering it. User-role
			// messages (tool_result echoes) are unaffected.
			return role === "assistant" ? NO_EVENTS : normalizeTextBlock(role, block);
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

// Curated session metadata pulled off the init line — the model, resumable
// session id, and the capabilities a "Claude Code online" UI surfaces (tools,
// slash commands, skills, MCP servers, permission mode). The raw init line
// (and every other system line: hooks, thinking-token counters, stream_event
// bookkeeping) is internal noise the user shouldn't see in the chat.
function sessionInfo(raw: Record<string, unknown>): Record<string, unknown> {
	return {
		sessionId: asString(raw.session_id),
		model: asString(raw.model),
		cwd: asString(raw.cwd),
		permissionMode: asString(raw.permissionMode),
		tools: raw.tools,
		slashCommands: raw.slash_commands,
		skills: raw.skills,
		mcpServers: raw.mcp_servers,
	};
}

function normalizeClaudeSystem(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	if (asString(raw.subtype) === "init") {
		return [
			{ kind: "status", status: "session_ready", detail: sessionInfo(raw) },
		];
	}
	// Every other system subtype (hooks, thinking_tokens, …) is internal noise.
	return NO_EVENTS;
}

// The turn's cost/usage, curated from the result line for a usage footer.
function normalizeClaudeResult(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	return [
		{
			kind: "status",
			status: "turn_usage",
			detail: {
				costUsd: raw.total_cost_usd,
				numTurns: raw.num_turns,
				durationMs: raw.duration_ms,
				usage: raw.usage,
				isError: raw.is_error === true,
			},
		},
	];
}

function normalizeClaudeStreamEvent(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	const event = raw.event;
	if (!isRecord(event)) {
		return NO_EVENTS;
	}
	const delta = event.delta;
	if (!isRecord(delta)) {
		return NO_EVENTS;
	}
	if (delta.type === "text_delta") {
		const text = asString(delta.text);
		return text === undefined ? NO_EVENTS : [{ kind: "output", text }];
	}
	if (delta.type === "thinking_delta") {
		const text = asString(delta.thinking);
		return text === undefined
			? NO_EVENTS
			: [{ kind: "output", reasoning: true, text }];
	}
	// Non-text/thinking stream_event frames are internal bookkeeping.
	return NO_EVENTS;
}

/**
 * Reads the `session_id` off claude's `{type:"system", subtype:"init"}` line, or
 * null for any other line. The adapter captures this from a turn's process so it
 * can `--resume <id>` the NEXT one-shot `claude -p` invocation, preserving the
 * conversation across turns without a long-lived process.
 */
export function extractClaudeSessionId(raw: unknown): string | null {
	if (!(isRecord(raw) && raw.type === "system" && raw.subtype === "init")) {
		return null;
	}
	return asString(raw.session_id) ?? null;
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
