import { z } from "zod";

// Mirrors the fields the tool-result registry reads from apps/mcp/src/x/
// x-types.ts's NormalizedTweet / NormalizedProfile. Scraped X data is messy and
// varies tweet-to-tweet, so these schemas are RESILIENT: only the discriminating
// id field is required (so a non-tweet/non-profile result still falls back to
// the raw block), and every display field has a `.catch` default or is nullable
// — a stray null count or odd media entry must never drop the whole card (which
// is what made lists render only the few items that happened to be pristine).

const NormalizedMediaSchema = z.object({
	sortOrder: z.number().catch(0),
	url: z.string().catch(""),
});

export const NormalizedTweetSchema = z.object({
	// The one required field: identifies this as a tweet. Everything else is
	// best-effort so real-world variance can't fail the render.
	tweetId: z.string(),
	authorScreenName: z.string().catch(""),
	fullText: z.string().catch(""),
	likeCount: z.number().catch(0),
	replyCount: z.number().catch(0),
	retweetCount: z.number().catch(0),
	viewCount: z.number().catch(0),
	postedAt: z.string().catch(""),
	media: z.array(NormalizedMediaSchema).catch([]),
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

export type NormalizedTweetData = z.infer<typeof NormalizedTweetSchema>;
export type NormalizedProfileData = z.infer<typeof NormalizedProfileSchema>;
