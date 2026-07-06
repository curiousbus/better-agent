// pi: `pi --mode rpc` — a long-lived process speaking a custom (not JSON-RPC
// 2.0) newline-delimited JSON protocol over stdio: commands sent on stdin are
// tagged by a `type` string (optionally an `id` for correlation), and so are
// the events/command-responses it writes back on stdout — there's no
// `method`/`result`/`error` envelope to reuse `jsonrpc-io.ts` for, so this
// mirrors claude-code.ts's plain `spawnProcessIo` wiring instead.
//
// ASSUMPTION (unverified — no `pi` binary available in this sandbox; shapes
// per https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md
// and docs/json.md): pi has **no built-in per-tool-call approval/permission
// protocol at all ("No permission popups. Run in a container, or build your
// own confirmation flow with extensions...", per its docs) — unlike codex/
// opencode/claude-code, this normalizer exports no `ApprovalEvent` mapping,
// and pi.ts wires an approval registry that only ever answers "unknown id"
// (nothing is ever `register()`ed) so `AgentHandle.answerApproval` still has
// well-defined behavior. Reverify the event field names below against the
// installed pi version before relying on them.

import {
	asString,
	isRecord,
	NO_EVENTS,
	type NormalizedEvent,
	type ToolEvent,
} from "./types";

function normalizePiTextDelta(
	assistantMessageEvent: Record<string, unknown>
): NormalizedEvent[] {
	if (assistantMessageEvent.type !== "text_delta") {
		return NO_EVENTS;
	}
	const text = asString(assistantMessageEvent.delta);
	return text === undefined ? NO_EVENTS : [{ kind: "output", text }];
}

function normalizePiMessageUpdate(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	return isRecord(raw.assistantMessageEvent)
		? normalizePiTextDelta(raw.assistantMessageEvent)
		: NO_EVENTS;
}

function normalizePiContentBlock(block: unknown): NormalizedEvent[] {
	if (!isRecord(block) || typeof block.type !== "string") {
		return NO_EVENTS;
	}
	if (block.type === "text") {
		// Already streamed live via `message_update` text_delta output — the
		// final message repeats the whole text, so drop it here to avoid
		// rendering the reply twice.
		return NO_EVENTS;
	}
	if (block.type === "thinking") {
		const text = asString(block.thinking);
		return text === undefined
			? NO_EVENTS
			: [{ kind: "message", role: "assistant", text, thinking: true }];
	}
	// "toolCall" blocks are deliberately skipped: `tool_execution_start/end`
	// already cover the same tool call, and re-emitting it here would double it.
	return NO_EVENTS;
}

/** Maps a `message_end` event's final `message.content` — a string or an
 * array of text/thinking/toolCall blocks — to normalized message events. Only
 * `role: "assistant"` messages carry content worth surfacing here; user/
 * toolResult/bashExecution messages either originated from us or are already
 * covered by `tool_execution_*` events. */
function normalizePiMessageEnd(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	const message = raw.message;
	if (!isRecord(message) || message.role !== "assistant") {
		return NO_EVENTS;
	}
	const content = message.content;
	if (typeof content === "string") {
		return content === ""
			? NO_EVENTS
			: [{ kind: "message", role: "assistant", text: content }];
	}
	if (!Array.isArray(content)) {
		return NO_EVENTS;
	}
	return content.flatMap(normalizePiContentBlock);
}

function normalizePiToolStart(raw: Record<string, unknown>): NormalizedEvent[] {
	const id = asString(raw.toolCallId);
	const name = asString(raw.toolName);
	return id === undefined || name === undefined
		? NO_EVENTS
		: [{ kind: "tool", id, name, status: "started", input: raw.args }];
}

/** `tool_execution_update` carries a `partialResult` while the tool is still
 * running — surfaced as another "started" tool event (there's no
 * "in-progress" status in `ToolEvent`) with that partial output attached. */
function normalizePiToolUpdate(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	const id = asString(raw.toolCallId);
	const name = asString(raw.toolName);
	return id === undefined || name === undefined
		? NO_EVENTS
		: [
				{
					kind: "tool",
					id,
					name,
					status: "started",
					input: raw.args,
					output: raw.partialResult,
				},
			];
}

function normalizePiToolEnd(raw: Record<string, unknown>): NormalizedEvent[] {
	const id = asString(raw.toolCallId);
	const name = asString(raw.toolName);
	if (id === undefined || name === undefined) {
		return NO_EVENTS;
	}
	const status: ToolEvent["status"] = raw.isError ? "failed" : "completed";
	return [{ kind: "tool", id, name, status, output: raw.result }];
}

function normalizePiResponse(raw: Record<string, unknown>): NormalizedEvent[] {
	if (raw.success !== false) {
		return NO_EVENTS;
	}
	const command = asString(raw.command) ?? "command";
	const message = asString(raw.error) ?? `pi ${command} failed`;
	return [{ kind: "error", message, detail: raw.error }];
}

function normalizePiExtensionError(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	const message = asString(raw.error) ?? "pi extension error";
	return [{ kind: "error", message, detail: raw }];
}

type PiEventHandler = (raw: Record<string, unknown>) => NormalizedEvent[];

const PI_STATUS_TYPES = new Set([
	"agent_start",
	"agent_end",
	"turn_start",
	"turn_end",
	"queue_update",
	"compaction_start",
	"compaction_end",
	"auto_retry_start",
	"auto_retry_end",
]);

const PI_EVENT_HANDLERS: Record<string, PiEventHandler> = {
	message_update: normalizePiMessageUpdate,
	message_end: normalizePiMessageEnd,
	tool_execution_start: normalizePiToolStart,
	tool_execution_update: normalizePiToolUpdate,
	tool_execution_end: normalizePiToolEnd,
	response: normalizePiResponse,
	extension_error: normalizePiExtensionError,
};

/** Maps one parsed line of `pi --mode rpc`'s stdout to normalized events. */
export function normalizePi(raw: unknown): NormalizedEvent[] {
	if (!isRecord(raw) || typeof raw.type !== "string") {
		return NO_EVENTS;
	}
	if (PI_STATUS_TYPES.has(raw.type)) {
		return [{ kind: "status", status: raw.type, detail: raw }];
	}
	const handler = PI_EVENT_HANDLERS[raw.type];
	return handler ? handler(raw) : NO_EVENTS;
}

/** Builds one `pi --mode rpc` stdin command for a user turn. */
export function buildPiPromptCommand(text: string): string {
	return JSON.stringify({ type: "prompt", message: text });
}

// --- session_ready: get_commands / get_state -------------------------------
//
// pi has no single "init" line the way claude-code does (see
// normalize/claude-code.ts's `normalizeClaudeSystem`) — its capabilities are
// only obtainable by *asking*, via two RPC commands the adapter sends once at
// start (see pi.ts): `get_commands` (slash commands + skills) and
// `get_state` (the current model). This module stays stateless like the rest
// of normalize/pi.ts, so it only parses each command's `response` line into
// its curated shape; pi.ts owns merging the two into one `session_ready`
// event and guarding against emitting it more than once.

/** Builds the `get_commands`/`get_state` stdin command frames pi.ts sends
 * once, right after the process starts. */
export function buildPiGetCommandsCommand(): string {
	return JSON.stringify({ type: "get_commands" });
}

export function buildPiGetStateCommand(): string {
	return JSON.stringify({ type: "get_state" });
}

/** A command entry as returned by `get_commands` — see
 * `normalizePiCommandsResponse`'s ASSUMPTION note below for the source. */
interface PiCommandInfo {
	name: string;
	source?: string;
}

function isPiCommandInfo(value: unknown): value is PiCommandInfo {
	return isRecord(value) && typeof value.name === "string";
}

/** Skill commands' `name` is prefixed this way in `get_commands`' response —
 * stripped for the curated `skills` list, kept as-is in `slashCommands` so
 * both remain directly invocable via `/<name>`. */
const PI_SKILL_PREFIX = "skill:";

function splitPiCommands(commands: PiCommandInfo[]): {
	skills: string[];
	slashCommands: string[];
} {
	const slashCommands: string[] = [];
	const skills: string[] = [];
	for (const command of commands) {
		slashCommands.push(command.name);
		if (
			command.source === "skill" &&
			command.name.startsWith(PI_SKILL_PREFIX)
		) {
			skills.push(command.name.slice(PI_SKILL_PREFIX.length));
		}
	}
	return { skills, slashCommands };
}

/**
 * Parses a `get_commands` RPC response's `data.commands` into
 * `session_ready`'s `slashCommands`/`skills` shape, or `null` if `raw` isn't
 * a successful `get_commands` response (a different command's response, a
 * failed one — see `normalizePiResponse` — or any other stdout line).
 *
 * ASSUMPTION (unverified — no `pi` binary available in this sandbox; shape
 * per https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md):
 * `data.commands` is `{name, description, source: "extension"|"prompt"|"skill", location?, path?}[]`;
 * skills are the entries with `source: "skill"`, whose `name` is prefixed
 * `skill:`. Reverify against the installed pi version before relying on this.
 */
export function normalizePiCommandsResponse(
	raw: unknown
): { skills: string[]; slashCommands: string[] } | null {
	if (
		!isRecord(raw) ||
		raw.type !== "response" ||
		raw.command !== "get_commands" ||
		raw.success !== true
	) {
		return null;
	}
	const data = raw.data;
	if (!(isRecord(data) && Array.isArray(data.commands))) {
		return null;
	}
	return splitPiCommands(data.commands.filter(isPiCommandInfo));
}

/**
 * Parses a `get_state` RPC response's `data.model` into a display model
 * name, or `undefined` if `raw` isn't a successful `get_state` response with
 * a model set yet.
 *
 * ASSUMPTION (unverified — same source as `normalizePiCommandsResponse`):
 * `data.model` is a full Model object (`{id, name, provider, ...}`) or
 * `null` if no model has been selected yet. `id` (e.g.
 * `"claude-sonnet-4-20250514"`) is preferred over the human-readable `name`
 * to match the other adapters' `model` field.
 */
export function normalizePiStateModel(raw: unknown): string | undefined {
	if (
		!isRecord(raw) ||
		raw.type !== "response" ||
		raw.command !== "get_state" ||
		raw.success !== true
	) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const data = raw.data;
	if (!(isRecord(data) && isRecord(data.model))) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return asString(data.model.id) ?? asString(data.model.name);
}
