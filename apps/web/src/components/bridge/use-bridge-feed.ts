import type { RawBridgeEvent, StreamEvent } from "./bridge-events";
import { mergeEvents } from "./event-feed";

export interface FeedState {
	events: StreamEvent[];
	maxSeenId: number;
}

export const initialFeedState: FeedState = { events: [], maxSeenId: 0 };

export type FeedAction =
	| { type: "events"; events: RawBridgeEvent[] }
	| { type: "reset" };

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
	if (action.type === "reset") {
		return initialFeedState;
	}
	const result = mergeEvents(state.events, state.maxSeenId, action.events);
	return { events: result.events, maxSeenId: result.maxSeenId };
}
