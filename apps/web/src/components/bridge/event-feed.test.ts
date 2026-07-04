import { describe, expect, it } from "vitest";
import { mergeEvents } from "./event-feed";

const statusEvent = (n: number) => ({
	id: n,
	data: { kind: "status", status: `step-${n}` },
});

describe("mergeEvents", () => {
	it("appends fresh events in order and advances the high-water mark", () => {
		const first = mergeEvents([], 0, [statusEvent(1), statusEvent(2)]);
		expect(first.events.map((e) => e.id)).toEqual([1, 2]);
		expect(first.maxSeenId).toBe(2);

		const second = mergeEvents(first.events, first.maxSeenId, [statusEvent(3)]);
		expect(second.events.map((e) => e.id)).toEqual([1, 2, 3]);
		expect(second.maxSeenId).toBe(3);
	});

	it("drops an exact repeat (poll re-requesting an already-seen window)", () => {
		const first = mergeEvents([], 0, [statusEvent(1), statusEvent(2)]);
		const repeat = mergeEvents(first.events, first.maxSeenId, [
			statusEvent(1),
			statusEvent(2),
		]);
		expect(repeat.events.map((e) => e.id)).toEqual([1, 2]);
		expect(repeat.maxSeenId).toBe(2);
	});

	it("drops replay/live overlap and keeps only the new tail", () => {
		const live = mergeEvents([], 0, [statusEvent(3)]);
		// A reconnect replays 1..3; only nothing new should be appended since 3
		// was already delivered by the live push.
		const replayed = mergeEvents(live.events, live.maxSeenId, [
			statusEvent(1),
			statusEvent(2),
			statusEvent(3),
		]);
		expect(replayed.events.map((e) => e.id)).toEqual([3]);
		expect(replayed.maxSeenId).toBe(3);
	});

	it("advances maxSeenId past malformed frames without rendering them", () => {
		const result = mergeEvents([], 0, [
			{ id: 1, data: { kind: "not-a-real-kind" } },
			statusEvent(2),
		]);
		expect(result.events.map((e) => e.id)).toEqual([2]);
		expect(result.maxSeenId).toBe(2);
	});

	it("returns the same events reference when nothing is fresh", () => {
		const current = mergeEvents([], 0, [statusEvent(1)]).events;
		const result = mergeEvents(current, 1, [statusEvent(1)]);
		expect(result.events).toBe(current);
	});
});
