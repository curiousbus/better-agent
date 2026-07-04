// Mirrors the normalized event union from `apps/bridge-cli/src/normalize/types.ts`.
// The CLI is a private standalone app (not a workspace package web can import),
// so the shape is duplicated here — only the six `kind`s and the fields the
// terminal view actually renders, not the full agent-protocol surface.

/** A single chat turn from either the user or the assistant. */
export interface MessageEvent {
	kind: "message";
	role: "user" | "assistant";
	text: string;
	thinking?: boolean;
}

/** A tool invocation, from request through to its result. */
export interface ToolEvent {
	id: string;
	input?: unknown;
	kind: "tool";
	name: string;
	output?: unknown;
	status: "started" | "completed" | "failed";
}

/** A file created/modified/deleted by the agent. */
export interface FileEvent {
	change: "created" | "modified" | "deleted";
	diff?: string;
	kind: "file";
	path: string;
}

/** Raw process output that doesn't fit the other kinds. */
export interface OutputEvent {
	kind: "output";
	stream?: "stdout" | "stderr";
	text: string;
}

/** Lifecycle/progress information (session init, turn start/end, retries…). */
export interface StatusEvent {
	detail?: unknown;
	kind: "status";
	status: string;
}

/** A recoverable-or-not error surfaced by the agent or its transport. */
export interface ErrorEvent {
	detail?: unknown;
	kind: "error";
	message: string;
}

export type NormalizedEvent =
	| MessageEvent
	| ToolEvent
	| FileEvent
	| OutputEvent
	| StatusEvent
	| ErrorEvent;

/** One relayed event as it comes off the wire (SSE `data:`/`id:` pair, or a
 * row from `bridge.observe`) — `data` is `unknown` until validated. */
export interface RawBridgeEvent {
	data: unknown;
	id: number;
}

/** A relayed event once its `data` has been validated into a NormalizedEvent. */
export interface StreamEvent {
	event: NormalizedEvent;
	id: number;
}

const EVENT_KINDS = new Set([
	"message",
	"tool",
	"file",
	"output",
	"status",
	"error",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates that `data` is at least shaped like a NormalizedEvent (a known
 * `kind`). Returns `null` for anything else so a malformed frame is dropped
 * instead of crashing the terminal's kind-switch render.
 */
export function parseNormalizedEvent(data: unknown): NormalizedEvent | null {
	if (!isRecord(data) || typeof data.kind !== "string") {
		return null;
	}
	return EVENT_KINDS.has(data.kind)
		? (data as unknown as NormalizedEvent)
		: null;
}
