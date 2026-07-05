// Adapter-side output truncation — the one choke point (wired into
// `relay-client.ts`'s `runBridgeSession`, upstream of every adapter's own
// `AgentHandle.events`) that keeps a single chatty agent line (e.g. a huge
// file dump piped to stdout) from ever tripping the server's per-event byte
// cap. See `MAX_EVENT_BYTES` in `packages/api/src/routers/bridge.ts`, which
// rejects the *whole* pushEvents batch outright instead of truncating —
// real shrinking has to happen here, before the event is ever sent.

import {
	type ApprovalEvent,
	type ErrorEvent,
	type FileEvent,
	isRecord,
	type MessageEvent,
	type NormalizedEvent,
	type OutputEvent,
	type StatusEvent,
	type ToolEvent,
} from "./normalize/types";

/** Max length (characters) of any single text-bearing field before it's
 * truncated. Comfortably under the server's 32_768-byte `MAX_EVENT_BYTES`
 * cap even once UTF-8 multi-byte characters and JSON-string-escaping
 * overhead are taken into account for a single field on its own — see
 * `MAX_EVENT_BYTES` below for the belt-and-suspenders check that covers the
 * case where *several* of an event's fields are each independently under
 * this cap but still add up to more than the server allows. */
export const MAX_EVENT_TEXT_CHARS = 16_000;

/** Mirrors `MAX_EVENT_BYTES` in `packages/api/src/routers/bridge.ts` — kept
 * as a local copy (bridge-cli and the api package don't share a runtime
 * constants module) so `truncateEvent` can detect an event that's still
 * oversized after every field has been truncated (e.g. a tool event whose
 * input *and* output are each independently under `MAX_EVENT_TEXT_CHARS`,
 * but not both at once) and degrade it instead of letting the server
 * reject the batch. Keep the two values in sync. */
const MAX_EVENT_BYTES = 32_768;

/** `status` value an oversized event degrades to once truncating its own
 * fields still isn't enough — see `truncateEvent`. */
const EVENT_TRUNCATED_STATUS = "event_truncated";

const NORMALIZED_EVENT_KINDS: ReadonlySet<NormalizedEvent["kind"]> = new Set([
	"message",
	"tool",
	"file",
	"output",
	"status",
	"error",
	"approval",
]);

/** Narrows an arbitrary relayed value down to a `NormalizedEvent` at
 * runtime. `truncateEvent` is called from the generic relay layer (see
 * `relay-client.ts`), which also carries plain values in tests — anything
 * that doesn't look like a normalized event passes through untouched. */
function isNormalizedEvent(value: unknown): value is NormalizedEvent {
	return (
		isRecord(value) &&
		typeof value.kind === "string" &&
		NORMALIZED_EVENT_KINDS.has(value.kind as NormalizedEvent["kind"])
	);
}

/** Truncates `value` to `MAX_EVENT_TEXT_CHARS`, appending a marker noting
 * how many characters were dropped. Returns `value` unchanged if it's
 * already short enough. */
function truncateString(value: string): string {
	if (value.length <= MAX_EVENT_TEXT_CHARS) {
		return value;
	}
	const droppedChars = value.length - MAX_EVENT_TEXT_CHARS;
	const head = value.slice(0, MAX_EVENT_TEXT_CHARS);
	return `${head}… [+${droppedChars} chars truncated]`;
}

/** Truncates a text-bearing field typed `unknown` (a tool's `input`/`output`,
 * a status/error event's `detail`): only strings are ever this long in
 * practice (structured payloads are left alone here and caught, if they push
 * the whole event over the byte cap, by `truncateEvent`'s final check). */
function truncateUnknownField(value: unknown): unknown {
	return typeof value === "string" ? truncateString(value) : value;
}

/** Serialized size of `value` in UTF-8 bytes, as JSON — mirrors `byteSizeOf`
 * in `packages/api/src/routers/bridge.ts`. */
function byteSizeOf(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

/** Shared by `MessageEvent` and `OutputEvent` — both are just a `text`
 * field alongside their discriminant. */
function truncateTextEvent<T extends MessageEvent | OutputEvent>(event: T): T {
	const text = truncateString(event.text);
	return text === event.text ? event : { ...event, text };
}

function truncateToolEvent(event: ToolEvent): ToolEvent {
	const input = truncateUnknownField(event.input);
	const output = truncateUnknownField(event.output);
	return input === event.input && output === event.output
		? event
		: { ...event, input, output };
}

function truncateFileEvent(event: FileEvent): FileEvent {
	if (event.diff === undefined) {
		return event;
	}
	const diff = truncateString(event.diff);
	return diff === event.diff ? event : { ...event, diff };
}

function truncateStatusEvent(event: StatusEvent): StatusEvent {
	const detail = truncateUnknownField(event.detail);
	return detail === event.detail ? event : { ...event, detail };
}

function truncateErrorEvent(event: ErrorEvent): ErrorEvent {
	const message = truncateString(event.message);
	const detail = truncateUnknownField(event.detail);
	return message === event.message && detail === event.detail
		? event
		: { ...event, message, detail };
}

function truncateApprovalEvent(event: ApprovalEvent): ApprovalEvent {
	const title = truncateString(event.title);
	const detail =
		event.detail === undefined ? event.detail : truncateString(event.detail);
	return title === event.title && detail === event.detail
		? event
		: { ...event, title, detail };
}

/** Dispatches to the per-kind truncation function above. Kept as a plain
 * dispatch table (no per-case logic of its own) so its cyclomatic
 * complexity stays low regardless of how many `NormalizedEvent` kinds
 * exist. */
function truncateEventFields(event: NormalizedEvent): NormalizedEvent {
	switch (event.kind) {
		case "message":
		case "output":
			return truncateTextEvent(event);
		case "tool":
			return truncateToolEvent(event);
		case "file":
			return truncateFileEvent(event);
		case "status":
			return truncateStatusEvent(event);
		case "error":
			return truncateErrorEvent(event);
		case "approval":
			return truncateApprovalEvent(event);
		default:
			return event;
	}
}

/** Degrades an event that's still over `MAX_EVENT_BYTES` after field
 * truncation to a small, deterministically-sized status event instead of
 * trying to shrink a structured payload further. */
function degradeToTruncatedStatus(event: NormalizedEvent): NormalizedEvent {
	return {
		detail: { originalKind: event.kind },
		kind: "status",
		status: EVENT_TRUNCATED_STATUS,
	};
}

/**
 * Truncates `value`'s text-bearing fields so it can never trip the server's
 * `MAX_EVENT_BYTES` rejection. Non-normalized-event values (see
 * `isNormalizedEvent`) pass through untouched — the relay layer this is
 * wired into (`relay-client.ts`) is generic over its event type. A
 * normalized event with every field already short is returned as the exact
 * same object (no defensive copying) so short events pass through untouched.
 */
export function truncateEvent(value: unknown): unknown {
	if (!isNormalizedEvent(value)) {
		return value;
	}
	const truncated = truncateEventFields(value);
	return byteSizeOf(truncated) <= MAX_EVENT_BYTES
		? truncated
		: degradeToTruncatedStatus(truncated);
}

/** Wraps `events` so every emitted value passes through `truncateEvent`
 * first — the single wiring point `runBridgeSession` (relay-client.ts) uses
 * to apply truncation uniformly to whichever adapter produced `events`,
 * without `forwardEvents` itself (which stays generic and untyped for
 * testability) needing to know anything about normalized events. */
export async function* truncateEvents(
	events: AsyncIterable<unknown>
): AsyncGenerator<unknown> {
	for await (const event of events) {
		yield truncateEvent(event);
	}
}
