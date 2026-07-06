// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { TweetCardFromTweet } from "./tweet-card-node";
import { NormalizedTweetSchema } from "./x-result-schemas";

const GRID_IMAGES = 2;
const LONG_TEXT_LENGTH = 400;

function parse(raw: unknown) {
	const result = NormalizedTweetSchema.safeParse(raw);
	if (!result.success) {
		throw new Error("expected the tweet to parse");
	}
	return result.data;
}

const EMBEDDED = {
	tweetId: "200",
	authorScreenName: "origauthor",
	authorName: "Original Author",
	authorAvatarUrl: "https://img/orig.jpg",
	fullText: "the quoted original content",
	kind: "original",
	likeCount: 9,
	replyCount: 1,
	retweetCount: 2,
	viewCount: 50,
	postedAt: "2026-01-01T00:00:00.000Z",
	media: [{ kind: "photo", sortOrder: 0, url: "https://img/orig-media.jpg" }],
};

it("parses avatar, name, kind, media kind and an embedded quoted tweet", () => {
	const tweet = parse({
		tweetId: "1",
		authorScreenName: "jack",
		authorName: "Jack D",
		authorAvatarUrl: "https://img/jack.jpg",
		fullText: "my take",
		kind: "quote",
		media: [{ kind: "video", sortOrder: 0, url: "https://vid/clip.mp4" }],
		quotedTweet: EMBEDDED,
	});
	expect(tweet.authorName).toBe("Jack D");
	expect(tweet.authorAvatarUrl).toBe("https://img/jack.jpg");
	expect(tweet.kind).toBe("quote");
	expect(tweet.media[0]?.kind).toBe("video");
	expect(tweet.quotedTweet?.tweetId).toBe("200");
});

it("tolerates missing display fields (only tweetId required)", () => {
	const tweet = parse({ tweetId: "9" });
	expect(tweet.authorAvatarUrl).toBeNull();
	expect(tweet.authorName).toBe("");
	expect(tweet.kind).toBe("original");
	expect(tweet.quotedTweet).toBeNull();
	expect(tweet.retweetedTweet).toBeNull();
});

it("renders avatar, display name, @handle and a media grid", () => {
	const tweet = parse({
		tweetId: "1",
		authorScreenName: "jack",
		authorName: "Jack D",
		authorAvatarUrl: "https://img/jack.jpg",
		fullText: "hello world",
		media: [
			{ kind: "photo", sortOrder: 0, url: "https://img/a.jpg" },
			{ kind: "photo", sortOrder: 1, url: "https://img/b.jpg" },
		],
	});
	const { container } = render(<TweetCardFromTweet tweet={tweet} />);
	const scope = within(container);
	expect(scope.getByText("Jack D")).toBeDefined();
	expect(
		scope.getByText(
			(_content, el) =>
				el?.tagName === "SPAN" && (el.textContent ?? "").startsWith("@jack")
		)
	).toBeDefined();
	expect(scope.getByAltText("Jack D avatar")).toBeDefined();
	expect(scope.getAllByAltText("Attached to tweet").length).toBe(GRID_IMAGES);
});

it("renders a nested quoted tweet beneath the text", () => {
	const tweet = parse({
		tweetId: "1",
		authorScreenName: "jack",
		fullText: "check this",
		kind: "quote",
		quotedTweet: EMBEDDED,
	});
	const { container } = render(<TweetCardFromTweet tweet={tweet} />);
	const scope = within(container);
	expect(scope.getByText("check this")).toBeDefined();
	expect(scope.getByText("the quoted original content")).toBeDefined();
	expect(scope.getByText("Original Author")).toBeDefined();
});

it("renders a retweet as a reposted header plus the embedded original", () => {
	const tweet = parse({
		tweetId: "1",
		authorScreenName: "reposter",
		fullText: "RT @origauthor: the quoted original content",
		kind: "retweet",
		retweetedTweet: EMBEDDED,
	});
	const { container } = render(<TweetCardFromTweet tweet={tweet} />);
	const scope = within(container);
	expect(scope.getByText("@reposter reposted")).toBeDefined();
	expect(scope.getByText("the quoted original content")).toBeDefined();
});

it("clamps long text behind a Show more toggle", () => {
	const longText = "a".repeat(LONG_TEXT_LENGTH);
	const tweet = parse({
		tweetId: "1",
		authorScreenName: "jack",
		fullText: longText,
	});
	const { container } = render(<TweetCardFromTweet tweet={tweet} />);
	const scope = within(container);
	const toggle = scope.getByRole("button", { name: "Show more" });
	expect(scope.queryByText(longText)).toBeNull();
	fireEvent.click(toggle);
	expect(scope.getByText(longText)).toBeDefined();
	expect(scope.getByRole("button", { name: "Show less" })).toBeDefined();
});
