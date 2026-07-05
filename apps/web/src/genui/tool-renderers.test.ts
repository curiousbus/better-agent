import { expect, it } from "vitest";
import { renderToolResult, TOOL_RESULT_RENDERERS } from "./tool-renderers";

const TWEET_FIXTURE = {
	authorScreenName: "jack",
	fullText: "hello",
	likeCount: 1,
	media: [],
	postedAt: "2026-01-01T00:00:00.000Z",
	replyCount: 0,
	retweetCount: 0,
	tweetId: "1",
	viewCount: 5,
};

function tweetTool() {
	const tool = TOOL_RESULT_RENDERERS.x_user_tweets;
	if (!tool) {
		throw new Error("x_user_tweets must be registered");
	}
	return tool;
}

it("parses an already-parsed array result", () => {
	expect(tweetTool().parse([TWEET_FIXTURE])).not.toBeNull();
});

it("parses the MCP content-envelope shape", () => {
	const envelope = {
		content: [{ text: JSON.stringify([TWEET_FIXTURE]), type: "text" }],
		isError: false,
	};
	expect(tweetTool().parse(envelope)).not.toBeNull();
});

it("parses a bare JSON string result (the real MCP tool-result shape)", () => {
	expect(tweetTool().parse(JSON.stringify([TWEET_FIXTURE]))).not.toBeNull();
});

it("returns null for malformed JSON", () => {
	expect(tweetTool().parse("{not json")).toBeNull();
});

it("returns null when the shape doesn't match the schema", () => {
	expect(tweetTool().parse({ unrelated: "shape" })).toBeNull();
});

it("renderToolResult returns null for an unregistered tool name", () => {
	expect(renderToolResult("not_a_real_tool", [TWEET_FIXTURE])).toBeNull();
});

it("renderToolResult returns a node for a registered success result", () => {
	expect(renderToolResult("x_user_tweets", [TWEET_FIXTURE])).not.toBeNull();
});

it("x_search_users parses a single profile object, not a list", () => {
	const profile = {
		description: null,
		displayName: "Jack",
		followersCount: 10,
		profileImageUrl: null,
		screenName: "jack",
		verified: false,
	};
	const parsed = TOOL_RESULT_RENDERERS.x_search_users?.parse(profile);
	expect(parsed).toEqual(profile);
});

it("renders the valid tweets even when one item in the list is malformed", () => {
	// A user timeline often mixes in an edge-case tweet (missing a count, odd
	// shape). One bad item must not blank the whole render — the good ones show.
	const malformed = { tweetId: "2", fullText: "no counts here" };
	const parsed = TOOL_RESULT_RENDERERS.x_user_tweets?.parse([
		TWEET_FIXTURE,
		malformed,
	]);
	expect(Array.isArray(parsed)).toBe(true);
	expect((parsed as unknown[]).length).toBe(1);
});

it("falls back (null) only when EVERY item in a non-empty list is unparseable", () => {
	const parsed = TOOL_RESULT_RENDERERS.x_user_tweets?.parse([
		{ nope: true },
		{ also: "bad" },
	]);
	expect(parsed).toBeNull();
});

it("parses an empty tweet list to an empty array (renders, does not fall back)", () => {
	const parsed = TOOL_RESULT_RENDERERS.x_user_tweets?.parse([]);
	expect(parsed).toEqual([]);
});
