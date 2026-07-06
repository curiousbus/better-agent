import { describe, expect, it } from "vitest";
import {
	parseTweetDetailTimeline,
	parseUserListTimeline,
} from "./x-raw-timeline";

// Minimal slices of X's raw GraphQL shape — camelCase envelope fields
// (entryType/itemType/itemContent), snake_case result wrappers
// (tweet_results/user_results) and __typename, matching the real responses the
// working user-tweets fixture uses.

function tweetItemEntry(id: string) {
	return {
		content: {
			entryType: "TimelineTimelineItem",
			itemContent: {
				itemType: "TimelineTweet",
				tweet_results: {
					result: { __typename: "Tweet", rest_id: id },
				},
			},
		},
	};
}

function userItemEntry(id: string) {
	return {
		content: {
			entryType: "TimelineTimelineItem",
			itemContent: {
				itemType: "TimelineUser",
				user_results: { result: { __typename: "User", rest_id: id } },
			},
		},
	};
}

describe("parseTweetDetailTimeline", () => {
	it("reads the threaded_conversation_with_injections_v2 path (not the user-timeline path)", () => {
		const json = {
			data: {
				threaded_conversation_with_injections_v2: {
					instructions: [
						{
							type: "TimelineAddEntries",
							entries: [tweetItemEntry("1"), tweetItemEntry("2")],
						},
					],
				},
			},
		};
		const page = parseTweetDetailTimeline(json);
		expect(page.rawTweets).toHaveLength(2);
	});

	it("returns nothing for a user-timeline-shaped response (wrong path)", () => {
		const json = {
			data: {
				user: { result: { timeline_v2: { timeline: { instructions: [] } } } },
			},
		};
		expect(parseTweetDetailTimeline(json).rawTweets).toEqual([]);
	});
});

// Wraps follower/following entries in the data.user.result.timeline.timeline
// path the Followers/Following endpoints actually use.
function userListJson(entries: unknown[]) {
	return {
		data: {
			user: {
				result: {
					timeline: {
						timeline: {
							instructions: [{ type: "TimelineAddEntries", entries }],
						},
					},
				},
			},
		},
	};
}

function userModuleEntry(id: string) {
	return {
		content: {
			entryType: "TimelineTimelineModule",
			items: [
				{
					item: {
						itemContent: {
							itemType: "TimelineUser",
							user_results: { result: { __typename: "User", rest_id: id } },
						},
					},
				},
			],
		},
	};
}

describe("parseUserListTimeline", () => {
	it("collects users from bare TimelineTimelineItem rows", () => {
		const json = userListJson([userItemEntry("1"), userItemEntry("2")]);
		expect(parseUserListTimeline(json)).toHaveLength(2);
	});

	it("also collects users nested inside a TimelineTimelineModule", () => {
		expect(
			parseUserListTimeline(userListJson([userModuleEntry("9")]))
		).toHaveLength(1);
	});
});
