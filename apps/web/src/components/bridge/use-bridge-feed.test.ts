import { describe, expect, it } from "vitest";
import type { MessageEvent } from "./bridge-events";
import { feedReducer, initialFeedState } from "./use-bridge-feed";

const statusRaw = (n: number) => ({
	id: n,
	data: { kind: "status", status: `step-${n}` },
});

describe("feedReducer localEcho", () => {
	it("appends a user message with a fresh negative id", () => {
		const state = feedReducer(initialFeedState, {
			type: "localEcho",
			text: "hello agent",
		});
		expect(state.events).toHaveLength(1);
		const [entry] = state.events;
		expect(entry.id).toBe(-1);
		const event = entry.event as MessageEvent;
		expect(event).toEqual({
			kind: "message",
			role: "user",
			text: "hello agent",
		});
		expect(event.thinking).toBeUndefined();
	});

	it("gives two echoes distinct, decrementing ids", () => {
		const first = feedReducer(initialFeedState, {
			type: "localEcho",
			text: "one",
		});
		const second = feedReducer(first, { type: "localEcho", text: "two" });
		expect(second.events.map((e) => e.id)).toEqual([-1, -2]);
		expect(second.nextLocalId).toBe(-3);
	});

	it("leaves maxSeenId untouched and never collides with server merges", () => {
		const withServer = feedReducer(initialFeedState, {
			type: "events",
			events: [statusRaw(1), statusRaw(2)],
		});
		expect(withServer.maxSeenId).toBe(2);

		const echoed = feedReducer(withServer, {
			type: "localEcho",
			text: "user line",
		});
		// The echo does not move the server high-water mark…
		expect(echoed.maxSeenId).toBe(2);
		// …and a subsequent server event still merges normally.
		const more = feedReducer(echoed, {
			type: "events",
			events: [statusRaw(3)],
		});
		expect(more.maxSeenId).toBe(3);
		expect(more.events.map((e) => e.id)).toEqual([1, 2, -1, 3]);
	});
});

describe("feedReducer anti-leak (raw RPC envelope)", () => {
	it("drops a wrapped oRPC {json:{ok:true}} envelope instead of rendering it", () => {
		const state = feedReducer(initialFeedState, {
			type: "events",
			events: [{ id: 1, data: { json: { ok: true } } }],
		});
		// parseNormalizedEvent has no recognized `kind`, so nothing renders…
		expect(state.events).toHaveLength(0);
		// …but the high-water mark still advances past the dropped frame.
		expect(state.maxSeenId).toBe(1);
	});

	it("drops a bare {ok:true} response the same way", () => {
		const state = feedReducer(initialFeedState, {
			type: "events",
			events: [{ id: 1, data: { ok: true } }],
		});
		expect(state.events).toHaveLength(0);
		expect(state.maxSeenId).toBe(1);
	});
});
