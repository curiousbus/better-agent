import type { RawBridgeEvent, StreamEvent } from "./bridge-events";
import { mergeEvents } from "./event-feed";

/** First id handed to an optimistic local echo. Local echoes count DOWN from
 * here (-1, -2, …); server ids are always ≥ 0, so a negative id can never
 * collide with one — which is why echoes can bypass `mergeEvents`'s
 * `maxSeenId` dedupe entirely. */
const INITIAL_LOCAL_ID = -1;

export interface FeedState {
	/** requestId -> chosen optionId, for approvals already answered this
	 * client session — a replayed approval for an answered requestId still
	 * renders disabled since this survives the event list being rebuilt. */
	answered: Record<string, string>;
	events: StreamEvent[];
	maxSeenId: number;
	/** Next id for an optimistic local echo — decrements on each `localEcho`,
	 * staying negative so it never collides with a server id. */
	nextLocalId: number;
}

export const initialFeedState: FeedState = {
	events: [],
	maxSeenId: 0,
	answered: {},
	nextLocalId: INITIAL_LOCAL_ID,
};

export type FeedAction =
	| { type: "events"; events: RawBridgeEvent[] }
	| { text: string; type: "localEcho" }
	| { optionId: string; requestId: string; type: "answer" }
	| { requestId: string; type: "unanswer" }
	| { type: "reset" };

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
	switch (action.type) {
		case "reset":
			return initialFeedState;
		case "answer":
			return {
				...state,
				answered: { ...state.answered, [action.requestId]: action.optionId },
			};
		case "unanswer": {
			const answered = { ...state.answered };
			delete answered[action.requestId];
			return { ...state, answered };
		}
		case "localEcho": {
			// Optimistic echo of the user's own line: appended directly (never
			// through `mergeEvents`) with a negative id, so it shows instantly and
			// leaves the server high-water mark untouched.
			const echo: StreamEvent = {
				id: state.nextLocalId,
				event: { kind: "message", role: "user", text: action.text },
			};
			return {
				...state,
				events: [...state.events, echo],
				nextLocalId: state.nextLocalId - 1,
			};
		}
		default: {
			const result = mergeEvents(state.events, state.maxSeenId, action.events);
			return { ...state, events: result.events, maxSeenId: result.maxSeenId };
		}
	}
}
