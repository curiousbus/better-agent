import {
	type AnyRecord,
	asBoolean,
	asNumber,
	asRecord,
	asString,
	pickBestMp4,
	readPath,
} from "./x-normalize-helpers";
import type {
	NormalizedMedia,
	NormalizedProfile,
	NormalizedTweet,
	XMediaKind,
	XTweetKind,
} from "./x-types";

function mediaKind(rawType: unknown): XMediaKind | null {
	if (rawType === "photo") {
		return "photo";
	}
	if (rawType === "video") {
		return "video";
	}
	if (rawType === "animated_gif") {
		return "gif";
	}
	return null;
}

function extractMediaItem(
	item: unknown,
	index: number
): NormalizedMedia | null {
	const rec = asRecord(item);
	if (!rec) {
		return null;
	}
	const kind = mediaKind(rec.type);
	if (!kind) {
		return null;
	}
	const width = asNumber(readPath(rec, "original_info.width"), null);
	const height = asNumber(readPath(rec, "original_info.height"), null);
	const base = { kind, width, height, sortOrder: index };

	if (kind === "photo") {
		const url = asString(rec.media_url_https);
		return url ? { ...base, url, bitrate: null, durationMs: null } : null;
	}
	const best = pickBestMp4(readPath(rec, "video_info.variants"));
	if (!best) {
		return null;
	}
	return {
		...base,
		url: best.url,
		bitrate: best.bitrate,
		durationMs: asNumber(readPath(rec, "video_info.duration_millis"), null),
	};
}

// ---------------------------------------------------------------------------
// Kind derivation
// ---------------------------------------------------------------------------

function pickKind(
	retweetedTweetId: string | null,
	quotedTweetId: string | null,
	replyToTweetId: string | null
): XTweetKind {
	if (retweetedTweetId) {
		return "retweet";
	}
	if (quotedTweetId) {
		return "quote";
	}
	if (replyToTweetId) {
		return "reply";
	}
	return "original";
}

// ---------------------------------------------------------------------------
// normalizeTweet
// ---------------------------------------------------------------------------

interface TweetRelations {
	quotedTweetId: string | null;
	replyToScreenName: string | null;
	replyToTweetId: string | null;
	retweetedTweetId: string | null;
}

function extractRelations(legacy: AnyRecord | null): TweetRelations {
	return {
		replyToTweetId: asString(readPath(legacy, "in_reply_to_status_id_str")),
		replyToScreenName: asString(readPath(legacy, "in_reply_to_screen_name")),
		quotedTweetId: asBoolean(readPath(legacy, "is_quote_status"))
			? asString(readPath(legacy, "quoted_status_id_str"))
			: null,
		retweetedTweetId: asString(
			readPath(legacy, "retweeted_status_result.result.legacy.id_str")
		),
	};
}

function extractCounts(rec: AnyRecord | null, legacy: AnyRecord | null) {
	return {
		likeCount: asNumber(readPath(legacy, "favorite_count"), 0),
		replyCount: asNumber(readPath(legacy, "reply_count"), 0),
		retweetCount: asNumber(readPath(legacy, "retweet_count"), 0),
		quoteCount: asNumber(readPath(legacy, "quote_count"), 0),
		viewCount: asNumber(readPath(rec, "views.count"), 0),
	};
}

function extractPostedAt(legacy: AnyRecord | null): Date {
	const createdAt = readPath(legacy, "created_at");
	return typeof createdAt === "string" && createdAt.length > 0
		? new Date(createdAt)
		: new Date();
}

function extractMedia(legacy: AnyRecord | null): NormalizedMedia[] {
	const mediaRaw = readPath(legacy, "extended_entities.media");
	if (!Array.isArray(mediaRaw)) {
		return [];
	}
	const out: NormalizedMedia[] = [];
	for (let i = 0; i < mediaRaw.length; i++) {
		const item = extractMediaItem(mediaRaw[i], i);
		if (item) {
			out.push(item);
		}
	}
	return out;
}

export function normalizeTweet(raw: unknown): NormalizedTweet {
	const rec = asRecord(raw);
	const legacy = asRecord(readPath(rec, "legacy"));

	const tweetId =
		asString(readPath(legacy, "id_str")) ?? asString(readPath(rec, "rest_id"));
	if (!tweetId) {
		throw new Error(
			"normalizeTweet: missing tweet id (legacy.id_str / rest_id)"
		);
	}
	const rel = extractRelations(legacy);
	const fullText =
		asString(readPath(rec, "note_tweet.note_tweet_results.result.text")) ??
		asString(readPath(legacy, "full_text")) ??
		"";

	return {
		tweetId,
		authorTwitterUserId:
			asString(readPath(rec, "core.user_results.result.rest_id")) ?? "",
		authorScreenName:
			asString(readPath(rec, "core.user_results.result.legacy.screen_name")) ??
			"",
		fullText,
		lang: asString(readPath(legacy, "lang")),
		kind: pickKind(rel.retweetedTweetId, rel.quotedTweetId, rel.replyToTweetId),
		replyToTweetId: rel.replyToTweetId,
		replyToScreenName: rel.replyToScreenName,
		quotedTweetId: rel.quotedTweetId,
		retweetedTweetId: rel.retweetedTweetId,
		...extractCounts(rec, legacy),
		postedAt: extractPostedAt(legacy),
		media: extractMedia(legacy),
	};
}

// ---------------------------------------------------------------------------
// normalizeProfile
// ---------------------------------------------------------------------------

export function normalizeProfile(raw: unknown): NormalizedProfile {
	const rec = asRecord(raw);
	const legacy = asRecord(readPath(rec, "legacy"));

	const twitterUserId = asString(readPath(rec, "restId"));
	if (!twitterUserId) {
		throw new Error("normalizeProfile: missing twitterUserId (restId)");
	}

	const screenName = asString(readPath(legacy, "screenName")) ?? "";
	const displayName = asString(readPath(legacy, "name")) ?? "";
	const description = asString(readPath(legacy, "description"));
	const location = asString(readPath(legacy, "location"));
	const profileImageUrl = asString(readPath(legacy, "profileImageUrlHttps"));
	const bannerUrl = asString(readPath(legacy, "profileBannerUrl"));
	const followersCount = asNumber(readPath(legacy, "followersCount"), 0);
	const friendsCount = asNumber(readPath(legacy, "friendsCount"), 0);
	const statusesCount = asNumber(readPath(legacy, "statusesCount"), 0);
	const verified =
		asBoolean(readPath(legacy, "verified")) ||
		asBoolean(readPath(rec, "isBlueVerified"));

	return {
		twitterUserId,
		screenName,
		displayName,
		description,
		location,
		profileImageUrl,
		bannerUrl,
		followersCount,
		friendsCount,
		statusesCount,
		verified,
	};
}
