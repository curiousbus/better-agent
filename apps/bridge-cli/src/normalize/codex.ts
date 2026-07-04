// codex: `codex app-server` — a long-lived JSON-RPC 2.0 process over stdio
// (the "jsonrpc" version field is omitted on the wire). We drive it with
// `thread/start` + `turn/start` requests and map the `item/*` and `turn/*`
// notifications streamed back during a turn. See
// https://developers.openai.com/codex/app-server for the protocol reference.

import {
	asString,
	isArrayOf,
	isRecord,
	NO_EVENTS,
	type NormalizedEvent,
} from "./types";

function isFileChangePath(path: unknown): path is string {
	return typeof path === "string";
}

function normalizeCodexFileChangeItem(
	item: Record<string, unknown>
): NormalizedEvent[] {
	const changes = item.changes;
	if (!Array.isArray(changes)) {
		return NO_EVENTS;
	}
	return changes.flatMap((entry): NormalizedEvent[] => {
		if (!(isRecord(entry) && isFileChangePath(entry.path))) {
			return NO_EVENTS;
		}
		const change =
			entry.kind === "created" || entry.kind === "deleted"
				? entry.kind
				: "modified";
		return [
			{ kind: "file", path: entry.path, change, diff: asString(entry.diff) },
		];
	});
}

function normalizeCodexCommandExecutionItem(
	item: Record<string, unknown>
): NormalizedEvent[] {
	const id = asString(item.id);
	if (id === undefined) {
		return NO_EVENTS;
	}
	const command = isArrayOf(
		item.command,
		(part): part is string => typeof part === "string"
	)
		? item.command.join(" ")
		: (asString(item.command) ?? "");
	return [
		{
			kind: "tool",
			id,
			name: "shell",
			status: item.status === "completed" ? "completed" : "started",
			input: command,
		},
	];
}

function normalizeCodexAgentMessageItem(
	item: Record<string, unknown>
): NormalizedEvent[] {
	const text = asString(item.text);
	return text === undefined
		? NO_EVENTS
		: [{ kind: "message", role: "assistant", text }];
}

function normalizeCodexItem(item: unknown): NormalizedEvent[] {
	if (!isRecord(item) || typeof item.type !== "string") {
		return NO_EVENTS;
	}
	switch (item.type) {
		case "agentMessage":
			return normalizeCodexAgentMessageItem(item);
		case "commandExecution":
			return normalizeCodexCommandExecutionItem(item);
		case "fileChange":
			return normalizeCodexFileChangeItem(item);
		default:
			return NO_EVENTS;
	}
}

function normalizeCodexAgentMessageDelta(
	params: Record<string, unknown>
): NormalizedEvent[] {
	const text = asString(params.delta);
	return text === undefined ? NO_EVENTS : [{ kind: "output", text }];
}

function normalizeCodexTurnFailed(
	params: Record<string, unknown>
): NormalizedEvent[] {
	const message = asString(params.error) ?? "codex turn failed";
	return [{ kind: "error", message, detail: params.error }];
}

type CodexNotificationHandler = (
	params: Record<string, unknown>
) => NormalizedEvent[];

const CODEX_NOTIFICATION_HANDLERS: Record<string, CodexNotificationHandler> = {
	"item/started": (params) => normalizeCodexItem(params.item),
	"item/completed": (params) => normalizeCodexItem(params.item),
	"item/agentMessage/delta": normalizeCodexAgentMessageDelta,
	"turn/started": (params) => [
		{ kind: "status", status: "turn_started", detail: params.turn },
	],
	"turn/completed": (params) => [
		{ kind: "status", status: "turn_completed", detail: params.turn },
	],
	"turn/failed": normalizeCodexTurnFailed,
};

/** Maps one parsed line of `codex app-server`'s stdout (JSON-RPC notifications). */
export function normalizeCodex(raw: unknown): NormalizedEvent[] {
	if (!isRecord(raw) || typeof raw.method !== "string") {
		return NO_EVENTS;
	}
	const params = raw.params;
	if (!isRecord(params)) {
		return NO_EVENTS;
	}
	const handler = CODEX_NOTIFICATION_HANDLERS[raw.method];
	return handler ? handler(params) : NO_EVENTS;
}
