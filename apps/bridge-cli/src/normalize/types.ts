// The normalized event model every adapter maps its agent's raw NDJSON onto.
// `kind` discriminates the payload shape; downstream consumers (relay-client,
// the server, the web UI) only ever need to understand these six shapes,
// never any agent-specific protocol.

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

/** Raw process output that doesn't fit the other kinds (e.g. shell output). */
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

export const NO_EVENTS: NormalizedEvent[] = [];

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isArrayOf<T>(
	value: unknown,
	guard: (item: unknown) => item is T
): value is T[] {
	return Array.isArray(value) && value.every(guard);
}

export function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
