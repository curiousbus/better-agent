export type XTweetKind = "original" | "reply" | "quote" | "retweet";
export type XMediaKind = "photo" | "video" | "gif";

export interface NormalizedMedia {
	bitrate: number | null;
	durationMs: number | null;
	height: number | null;
	kind: XMediaKind;
	sortOrder: number;
	url: string;
	width: number | null;
}

export interface NormalizedTweet {
	authorScreenName: string;
	authorTwitterUserId: string;
	fullText: string;
	kind: XTweetKind;
	lang: string | null;
	likeCount: number;
	media: NormalizedMedia[];
	postedAt: Date;
	quoteCount: number;
	quotedTweetId: string | null;
	replyCount: number;
	replyToScreenName: string | null;
	replyToTweetId: string | null;
	retweetCount: number;
	retweetedTweetId: string | null;
	tweetId: string;
	viewCount: number;
}

export interface NormalizedProfile {
	bannerUrl: string | null;
	description: string | null;
	displayName: string;
	followersCount: number;
	friendsCount: number;
	location: string | null;
	profileImageUrl: string | null;
	screenName: string;
	statusesCount: number;
	twitterUserId: string;
	verified: boolean;
}

export interface XCollectResult {
	errorMessage?: string;
	fetched: number;
	inserted: number;
	newTweetIds: string[];
	runId: string;
	status: "success" | "failed" | "skipped";
}
