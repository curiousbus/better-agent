import { describe, expect, it } from "vitest";
import {
	connectionReducer,
	initialConnectionState,
	MAX_SSE_FAILURES,
} from "./terminal-connection";

describe("connectionReducer", () => {
	it("starts connecting and flips to live on open", () => {
		const state = connectionReducer(initialConnectionState, { type: "open" });
		expect(state).toEqual({
			status: "live",
			failureCount: 0,
			everConnected: true,
		});
	});

	it("degrades to polling only after MAX_SSE_FAILURES consecutive errors", () => {
		let state = initialConnectionState;
		for (let i = 0; i < MAX_SSE_FAILURES - 1; i++) {
			state = connectionReducer(state, { type: "error" });
			expect(state.status).toBe("connecting");
		}
		state = connectionReducer(state, { type: "error" });
		expect(state.status).toBe("polling");
		expect(state.failureCount).toBe(MAX_SSE_FAILURES);
	});

	it("a later open resets the failure count back to live", () => {
		let state = initialConnectionState;
		state = connectionReducer(state, { type: "error" });
		state = connectionReducer(state, { type: "open" });
		expect(state).toEqual({
			status: "live",
			failureCount: 0,
			everConnected: true,
		});
	});

	it("marks everConnected once a poll succeeds, without changing status", () => {
		const polling = {
			status: "polling",
			failureCount: 3,
			everConnected: false,
		} as const;
		const state = connectionReducer(polling, { type: "polled" });
		expect(state.everConnected).toBe(true);
		expect(state.status).toBe("polling");
	});

	it("reset returns to the initial state", () => {
		const state = connectionReducer(
			{ status: "live", failureCount: 0, everConnected: true },
			{ type: "reset" }
		);
		expect(state).toEqual(initialConnectionState);
	});
});
