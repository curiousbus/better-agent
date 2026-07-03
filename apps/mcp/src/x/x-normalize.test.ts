import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/user-tweets-page.json";
import { normalizeTweet } from "./x-normalize";
import { parseUserTweetsTimeline } from "./x-raw-timeline";

describe("x timeline parsing + normalize", () => {
	it("walks a user-tweets page and normalizes each tweet", () => {
		const { rawTweets } = parseUserTweetsTimeline(fixture);
		expect(rawTweets.length).toBeGreaterThan(0);

		const tweets = rawTweets.map(normalizeTweet);
		const first = tweets[0];
		expect(first?.tweetId).toBeTruthy();
		expect(typeof first?.fullText).toBe("string");
		expect(first?.postedAt).toBeInstanceOf(Date);
		expect(["original", "reply", "quote", "retweet"]).toContain(first?.kind);
	});

	it("returns an empty page for unrelated JSON without throwing", () => {
		const { rawTweets, bottomCursor } = parseUserTweetsTimeline({
			data: { other: true },
		});
		expect(rawTweets).toEqual([]);
		expect(bottomCursor).toBeNull();
	});
});
