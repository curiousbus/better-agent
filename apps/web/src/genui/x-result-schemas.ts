import { z } from "zod";

// Mirrors the fields the tool-result registry reads from apps/mcp/src/x/
// x-types.ts's NormalizedTweet / NormalizedProfile. Scraped X data is messy and
// varies tweet-to-tweet, so these schemas are RESILIENT: only the discriminating
// id field is required (so a non-tweet/non-profile result still falls back to
// the raw block), and every display field has a `.catch` default or is nullable
// — a stray null count or odd media entry must never drop the whole card (which
// is what made lists render only the few items that happened to be pristine).

const TweetKindSchema = z
	.enum(["original", "reply", "quote", "retweet"])
	.catch("original");

const MediaKindSchema = z.enum(["photo", "video", "gif"]).catch("photo");

const NormalizedMediaSchema = z.object({
	kind: MediaKindSchema,
	sortOrder: z.number().catch(0),
	url: z.string().catch(""),
});

// The nested tweet embedded inside a retweet/quote: same display fields as a
// top-level tweet MINUS its own embeds (the MCP normalizer bounds recursion to
// one level, so there is never a deeper nest to carry).
const EmbeddedTweetSchema = z.object({
	tweetId: z.string(),
	authorScreenName: z.string().catch(""),
	authorName: z.string().catch(""),
	authorAvatarUrl: z.string().nullable().catch(null),
	fullText: z.string().catch(""),
	likeCount: z.number().catch(0),
	replyCount: z.number().catch(0),
	retweetCount: z.number().catch(0),
	viewCount: z.number().catch(0),
	postedAt: z.string().catch(""),
	media: z.array(NormalizedMediaSchema).catch([]),
});

export const NormalizedTweetSchema = z.object({
	// The one required field: identifies this as a tweet. Everything else is
	// best-effort so real-world variance can't fail the render.
	tweetId: z.string(),
	authorScreenName: z.string().catch(""),
	authorName: z.string().catch(""),
	authorAvatarUrl: z.string().nullable().catch(null),
	fullText: z.string().catch(""),
	kind: TweetKindSchema,
	likeCount: z.number().catch(0),
	replyCount: z.number().catch(0),
	retweetCount: z.number().catch(0),
	viewCount: z.number().catch(0),
	postedAt: z.string().catch(""),
	media: z.array(NormalizedMediaSchema).catch([]),
	quotedTweet: EmbeddedTweetSchema.nullable().catch(null),
	retweetedTweet: EmbeddedTweetSchema.nullable().catch(null),
});

export const NormalizedProfileSchema = z.object({
	// Required discriminator; the rest is best-effort.
	screenName: z.string(),
	displayName: z.string().catch(""),
	description: z.string().nullable().catch(null),
	followersCount: z.number().catch(0),
	profileImageUrl: z.string().nullable().catch(null),
	verified: z.boolean().catch(false),
});

export type NormalizedMediaData = z.infer<typeof NormalizedMediaSchema>;
export type EmbeddedTweetData = z.infer<typeof EmbeddedTweetSchema>;
export type NormalizedTweetData = z.infer<typeof NormalizedTweetSchema>;
export type NormalizedProfileData = z.infer<typeof NormalizedProfileSchema>;
