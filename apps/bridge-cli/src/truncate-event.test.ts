import { describe, expect, it } from "vitest";
import type {
	ApprovalEvent,
	ApprovalOption,
	FileEvent,
	MessageEvent,
	OutputEvent,
	ToolEvent,
} from "./normalize/types";
import {
	MAX_APPROVAL_OPTIONS,
	MAX_EVENT_TEXT_CHARS,
	truncateEvent,
	truncateEvents,
} from "./truncate-event";

const MAX_EVENT_BYTES = 32_768;
const OVERFLOW_CHARS = 500;
const EMOJI_REPEAT_COUNT = 9000; // 2 UTF-16 units each → 18_000 units, over the cap
const NON_EVENT_NUMBER = 42;
const HUGE_APPROVAL_TEXT_CHARS = 50_000;
const PATHOLOGICAL_OPTION_COUNT = 5000;

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

/** Approvals must never degrade wholesale (see `degradeToTruncatedStatus`):
 * losing `requestId`/`options` would leave the agent's approval flow hanging
 * forever with no way for the user to answer it. A huge title alongside huge
 * option labels must still come back as a structurally valid approval. */
function keepsAHugeApprovalAliveAsAnApproval(): void {
	const options: ApprovalOption[] = [
		{ id: "opt-1", label: "y".repeat(HUGE_APPROVAL_TEXT_CHARS) },
		{ id: "opt-2", label: "z".repeat(HUGE_APPROVAL_TEXT_CHARS) },
	];
	const event: ApprovalEvent = {
		detail: "w".repeat(HUGE_APPROVAL_TEXT_CHARS),
		kind: "approval",
		options,
		requestId: "req-1",
		title: "x".repeat(HUGE_APPROVAL_TEXT_CHARS),
	};

	const result = truncateEvent(event) as ApprovalEvent;

	expect(result.kind).toBe("approval");
	expect(result.requestId).toBe("req-1");
	expect(byteSizeOf(result)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
}

/** A pathologically long `options[]` array (each label already short) can
 * still blow past the byte cap purely on count — the field-level truncation
 * in `truncateApprovalEvent` can't help there, so the array itself must be
 * capped at `MAX_APPROVAL_OPTIONS` while keeping `requestId`/`kind` intact. */
function capsAPathologicallyLongApprovalOptionsList(): void {
	const options: ApprovalOption[] = Array.from(
		{ length: PATHOLOGICAL_OPTION_COUNT },
		(_, index) => ({ id: `opt-${index}`, label: `option ${index}` })
	);
	const event: ApprovalEvent = {
		kind: "approval",
		options,
		requestId: "req-2",
		title: "pick one",
	};

	const result = truncateEvent(event) as ApprovalEvent;

	expect(result.kind).toBe("approval");
	expect(result.requestId).toBe("req-2");
	expect(result.options.length).toBeLessThanOrEqual(MAX_APPROVAL_OPTIONS);
	expect(byteSizeOf(result)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
}

/** A file event's `path` is just as capable of overflowing as its `diff` —
 * it needs the same truncation treatment. */
function truncatesAFileEventsOverLongPathWithNoDiff(): void {
	const path = "/".repeat(MAX_EVENT_TEXT_CHARS + OVERFLOW_CHARS);
	const event: FileEvent = { change: "created", kind: "file", path };

	const result = truncateEvent(event) as FileEvent;

	expect(result.kind).toBe("file");
	expect(result.path.length).toBeLessThan(path.length);
	expect(byteSizeOf(result)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
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
		"keeps a huge approval (title + option labels) alive as an approval instead of degrading it",
		keepsAHugeApprovalAliveAsAnApproval
	);

	it(
		"caps a pathologically long approval options list instead of degrading the whole event",
		capsAPathologicallyLongApprovalOptionsList
	);

	it(
		"truncates a file event's over-long path when there's no diff",
		truncatesAFileEventsOverLongPathWithNoDiff
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
