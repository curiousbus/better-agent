import { ORPCError } from "@orpc/server";

// Server-side size caps for the local agent bridge (spec §3.1: truncate
// oversized lines + bound the window). Extracted from the bridge router so the
// router file stays under the per-file line cap.

/** Max serialized size (bytes) of a single pushed event before it's rejected.
 * Mirrored in `apps/bridge-cli/src/truncate-event.ts`'s `MAX_EVENT_BYTES` —
 * the CLI truncates event fields down to (comfortably) under this same cap
 * before ever sending an event here, so real oversized batches shouldn't
 * happen in practice. Keep the two values in sync. */
const MAX_EVENT_BYTES = 32_768;
/** Max size (characters) of sendInput's `data` before it's rejected. */
const MAX_INPUT_CHARS = 8192;

/** Serialized size of `value` in UTF-8 bytes, as JSON. */
function byteSizeOf(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

/** Serialized size of `value` in characters: raw length for a string,
 * JSON length otherwise. */
function charSizeOf(value: unknown): number {
	if (typeof value === "string") {
		return value.length;
	}
	return (JSON.stringify(value) ?? "").length;
}

/** Rejects the whole call with BAD_REQUEST naming the first oversized event,
 * rather than silently truncating — real line-truncation belongs in the
 * CLI's adapters, which know how to shrink an event without corrupting it. */
export function assertEventsWithinSizeLimit(events: readonly unknown[]): void {
	for (const [index, event] of events.entries()) {
		if (byteSizeOf(event) > MAX_EVENT_BYTES) {
			throw new ORPCError("BAD_REQUEST", {
				message: `Event at index ${index} exceeds ${MAX_EVENT_BYTES} bytes`,
			});
		}
	}
}

export function assertInputWithinSizeLimit(data: unknown): void {
	if (charSizeOf(data) > MAX_INPUT_CHARS) {
		throw new ORPCError("BAD_REQUEST", {
			message: `sendInput data exceeds ${MAX_INPUT_CHARS} characters`,
		});
	}
}
