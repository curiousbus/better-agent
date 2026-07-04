// Pure state machine for the terminal's connection indicator. SSE is the
// primary transport; after MAX_SSE_FAILURES consecutive failures it degrades
// to polling permanently for that session (no automatic recovery back to
// live — a session refresh/reselect resets it via the "reset" action).

export type ConnectionStatus = "connecting" | "live" | "polling";

export const MAX_SSE_FAILURES = 3;

export interface ConnectionState {
	everConnected: boolean;
	failureCount: number;
	status: ConnectionStatus;
}

export const initialConnectionState: ConnectionState = {
	status: "connecting",
	failureCount: 0,
	everConnected: false,
};

export type ConnectionAction =
	| { type: "open" }
	| { type: "error" }
	| { type: "polled" }
	| { type: "reset" };

export function connectionReducer(
	state: ConnectionState,
	action: ConnectionAction
): ConnectionState {
	switch (action.type) {
		case "open":
			return { status: "live", failureCount: 0, everConnected: true };
		case "polled":
			return { ...state, everConnected: true };
		case "error": {
			const failureCount = state.failureCount + 1;
			const status =
				failureCount >= MAX_SSE_FAILURES ? "polling" : "connecting";
			return { ...state, status, failureCount };
		}
		case "reset":
			return initialConnectionState;
		default:
			return state;
	}
}
