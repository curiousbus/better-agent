import { expect, it } from "vitest";
import {
	isTaskToolInput,
	renderToolResult,
	TOOL_RESULT_RENDERERS,
} from "./tool-renderers";

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

it("isTaskToolInput detects opencode's subagent_type shape", () => {
	expect(
		isTaskToolInput({
			description: "Explore project structure",
			prompt: "Explore the project at ...",
			subagent_type: "explore",
		})
	).toBe(true);
});

it("isTaskToolInput detects a description+prompt pair with no subagent_type", () => {
	expect(
		isTaskToolInput({ description: "Run tests", prompt: "Run the suite" })
	).toBe(true);
});

it("isTaskToolInput is false for an ordinary tool's input", () => {
	expect(isTaskToolInput({ cmd: "ls" })).toBe(false);
	expect(isTaskToolInput(undefined)).toBe(false);
	expect(isTaskToolInput(null)).toBe(false);
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

it("keeps a tweet that is only missing display fields (defaults fill in)", () => {
	// The resilient schema requires only tweetId; a tweet with no counts/media
	// still renders (counts default to 0) rather than being dropped.
	const sparse = { tweetId: "2", fullText: "just an id and text" };
	const parsed = TOOL_RESULT_RENDERERS.x_user_tweets?.parse([
		TWEET_FIXTURE,
		sparse,
	]);
	expect(Array.isArray(parsed)).toBe(true);
	expect((parsed as unknown[]).length).toBe(2);
});

it("skips a non-tweet item (no tweetId) but keeps the real tweets", () => {
	// Only an item with NO tweetId is truly unparseable — it's skipped, the real
	// tweet still renders.
	const parsed = TOOL_RESULT_RENDERERS.x_user_tweets?.parse([
		TWEET_FIXTURE,
		{ notATweet: true },
	]);
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
