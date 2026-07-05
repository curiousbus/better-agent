import type { RawBridgeEvent, StreamEvent } from "./bridge-events";
import { mergeEvents } from "./event-feed";

export interface FeedState {
	/** requestId -> chosen optionId, for approvals already answered this
	 * client session — a replayed approval for an answered requestId still
	 * renders disabled since this survives the event list being rebuilt. */
	answered: Record<string, string>;
	events: StreamEvent[];
	maxSeenId: number;
}

export const initialFeedState: FeedState = {
	events: [],
	maxSeenId: 0,
	answered: {},
};

export type FeedAction =
	| { type: "events"; events: RawBridgeEvent[] }
	| { optionId: string; requestId: string; type: "answer" }
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
		default: {
			const result = mergeEvents(state.events, state.maxSeenId, action.events);
			return { ...state, events: result.events, maxSeenId: result.maxSeenId };
		}
	}
}
