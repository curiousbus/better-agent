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

function rawAuthor(screenName: string, name: string, avatar: string) {
	return {
		core: {
			user_results: {
				result: {
					rest_id: "999",
					legacy: {
						screen_name: screenName,
						name,
						profile_image_url_https: avatar,
					},
				},
			},
		},
	};
}

function rawTweet(idStr: string, text: string, screenName: string) {
	return {
		rest_id: idStr,
		legacy: { id_str: idStr, full_text: text, created_at: "" },
		...rawAuthor(
			screenName,
			`${screenName} Display`,
			`https://img/${screenName}.jpg`
		),
	};
}

describe("normalizeTweet author", () => {
	it("extracts author display name and avatar", () => {
		const tweet = normalizeTweet(rawTweet("1", "hi", "acct"));
		expect(tweet.authorName).toBe("acct Display");
		expect(tweet.authorAvatarUrl).toBe("https://img/acct.jpg");
		expect(tweet.retweetedTweet).toBeNull();
		expect(tweet.quotedTweet).toBeNull();
	});
});

describe("normalizeTweet embedded tweets", () => {
	it("embeds the reposted original for a retweet, one level deep", () => {
		const inner = rawTweet("100", "original post", "author");
		const raw = {
			rest_id: "2",
			legacy: {
				id_str: "2",
				full_text: "RT @author: original post",
				created_at: "",
				retweeted_status_result: { result: inner },
			},
			...rawAuthor("reposter", "Reposter", "https://img/reposter.jpg"),
		};
		const tweet = normalizeTweet(raw);
		expect(tweet.kind).toBe("retweet");
		expect(tweet.retweetedTweet?.tweetId).toBe("100");
		expect(tweet.retweetedTweet?.fullText).toBe("original post");
		expect(tweet.retweetedTweet?.authorName).toBe("author Display");
		// One level deep: the embedded tweet does not carry its own embeds.
		expect(tweet.retweetedTweet?.retweetedTweet).toBeNull();
	});

	it("embeds the quoted original tweet", () => {
		const inner = rawTweet("200", "quoted content", "quoted");
		const raw = {
			rest_id: "3",
			legacy: {
				id_str: "3",
				full_text: "my take",
				created_at: "",
				is_quote_status: true,
				quoted_status_id_str: "200",
			},
			quoted_status_result: { result: inner },
			...rawAuthor("quoter", "Quoter", "https://img/quoter.jpg"),
		};
		const tweet = normalizeTweet(raw);
		expect(tweet.kind).toBe("quote");
		expect(tweet.quotedTweet?.tweetId).toBe("200");
		expect(tweet.quotedTweet?.fullText).toBe("quoted content");
		expect(tweet.quotedTweet?.quotedTweet).toBeNull();
	});
});

describe("normalizeTweet embed guards", () => {
	it("does not recurse into a malformed embedded tweet", () => {
		const raw = {
			rest_id: "4",
			legacy: {
				id_str: "4",
				full_text: "x",
				created_at: "",
				retweeted_status_result: { result: { nope: true } },
			},
			...rawAuthor("a", "A", ""),
		};
		const tweet = normalizeTweet(raw);
		expect(tweet.retweetedTweet).toBeNull();
	});
});
