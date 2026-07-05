import { describe, expect, it } from "vitest";
import type { MessageEvent, OutputEvent, ToolEvent } from "./normalize/types";
import {
	MAX_EVENT_TEXT_CHARS,
	truncateEvent,
	truncateEvents,
} from "./truncate-event";

const MAX_EVENT_BYTES = 32_768;
const OVERFLOW_CHARS = 500;
const EMOJI_REPEAT_COUNT = 9000; // 2 UTF-16 units each → 18_000 units, over the cap
const NON_EVENT_NUMBER = 42;

function byteSizeOf(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

function truncatesAnOverLongOutputEventsText(): void {
	const text = "a".repeat(MAX_EVENT_TEXT_CHARS + OVERFLOW_CHARS);
	const event: OutputEvent = { kind: "output", text };

	const result = truncateEvent(event) as OutputEvent;

	expect(result.kind).toBe("output");
	expect(result.text).toBe(
		`${"a".repeat(MAX_EVENT_TEXT_CHARS)}… [+${OVERFLOW_CHARS} chars truncated]`
	);
	expect(byteSizeOf(result)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
}

function truncatesAnOverLongMessageEventsText(): void {
	const text = "b".repeat(MAX_EVENT_TEXT_CHARS + OVERFLOW_CHARS);
	const event: MessageEvent = { kind: "message", role: "assistant", text };

	const result = truncateEvent(event) as MessageEvent;

	expect(result.text.endsWith(`… [+${OVERFLOW_CHARS} chars truncated]`)).toBe(
		true
	);
	expect(result.text.length).toBeLessThan(text.length);
}

function truncatesAToolEventsHugeStringResult(): void {
	const output = "c".repeat(MAX_EVENT_TEXT_CHARS + OVERFLOW_CHARS);
	const event: ToolEvent = {
		id: "t1",
		kind: "tool",
		name: "shell",
		output,
		status: "completed",
	};

	const result = truncateEvent(event) as ToolEvent;

	expect(result.kind).toBe("tool");
	expect(typeof result.output).toBe("string");
	expect((result.output as string).length).toBeLessThan(output.length);
}

/** Each field truncates to MAX_EVENT_TEXT_CHARS on its own, but an emoji (a
 * 2-unit, 4-byte UTF-8 surrogate pair) is much heavier per character than
 * ASCII — filling *two* fields this way blows past the server's
 * 32_768-byte cap even though each field individually respects
 * MAX_EVENT_TEXT_CHARS, so the whole event must degrade instead. */
function degradesAnEventStillOverTheByteCapAfterFieldTruncation(): void {
	const hugeEmoji = "\u{1F600}".repeat(EMOJI_REPEAT_COUNT);
	const event: ToolEvent = {
		id: "t2",
		input: hugeEmoji,
		kind: "tool",
		name: "shell",
		output: hugeEmoji,
		status: "completed",
	};

	const result = truncateEvent(event);

	expect(byteSizeOf(result)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
	expect(result).toEqual({
		detail: { originalKind: "tool" },
		kind: "status",
		status: "event_truncated",
	});
}

function leavesAShortEventUntouched(): void {
	const event: MessageEvent = {
		kind: "message",
		role: "assistant",
		text: "hello",
	};

	expect(truncateEvent(event)).toBe(event);
}

function passesThroughNonNormalizedEventValues(): void {
	expect(truncateEvent("plain string")).toBe("plain string");
	expect(truncateEvent(NON_EVENT_NUMBER)).toBe(NON_EVENT_NUMBER);
}

describe("truncateEvent", () => {
	it(
		"truncates an over-long output event's text with the marker",
		truncatesAnOverLongOutputEventsText
	);

	it(
		"truncates an over-long message event's text with the marker",
		truncatesAnOverLongMessageEventsText
	);

	it(
		"truncates a tool event's huge string result",
		truncatesAToolEventsHugeStringResult
	);

	it(
		"degrades to a status event when fields are individually short enough but the whole event still exceeds the server's byte cap",
		degradesAnEventStillOverTheByteCapAfterFieldTruncation
	);

	it(
		"leaves a short event untouched (same object identity)",
		leavesAShortEventUntouched
	);

	it(
		"passes through values that aren't normalized events",
		passesThroughNonNormalizedEventValues
	);
});

async function* arrayEvents<T>(values: T[]): AsyncGenerator<T> {
	await Promise.resolve();
	for (const value of values) {
		yield value;
	}
}

async function truncatesEveryEventInTheStream(): Promise<void> {
	const text = "d".repeat(MAX_EVENT_TEXT_CHARS + OVERFLOW_CHARS);
	const events: OutputEvent[] = [
		{ kind: "output", text: "short" },
		{ kind: "output", text },
	];

	const results: unknown[] = [];
	for await (const event of truncateEvents(arrayEvents(events))) {
		results.push(event);
	}

	expect(results[0]).toBe(events[0]);
	expect((results[1] as OutputEvent).text.length).toBeLessThan(text.length);
}

describe("truncateEvents", () => {
	it("truncates every event in the stream", truncatesEveryEventInTheStream);
});
