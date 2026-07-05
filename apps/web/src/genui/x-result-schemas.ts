import { z } from "zod";

// Mirrors the fields the tool-result registry actually reads from
// apps/mcp/src/x/x-types.ts's NormalizedTweet / NormalizedProfile — not every
// field on those types, just the ones TweetCard/UserCard render. Extra keys
// on the real payload are ignored by zod, not rejected.

const NormalizedMediaSchema = z.object({
	sortOrder: z.number(),
	url: z.string(),
});

export const NormalizedTweetSchema = z.object({
	authorScreenName: z.string(),
	fullText: z.string(),
	likeCount: z.number(),
	media: z.array(NormalizedMediaSchema),
	postedAt: z.string(),
	replyCount: z.number(),
	retweetCount: z.number(),
	tweetId: z.string(),
	viewCount: z.number(),
});

export const TweetListSchema = z.array(NormalizedTweetSchema);

export const NormalizedProfileSchema = z.object({
	description: z.string().nullable(),
	displayName: z.string(),
	followersCount: z.number(),
	profileImageUrl: z.string().nullable(),
	screenName: z.string(),
	verified: z.boolean(),
});

export const ProfileListSchema = z.array(NormalizedProfileSchema);

export type NormalizedTweetData = z.infer<typeof NormalizedTweetSchema>;
export type TweetListData = z.infer<typeof TweetListSchema>;
export type NormalizedProfileData = z.infer<typeof NormalizedProfileSchema>;
export type ProfileListData = z.infer<typeof ProfileListSchema>;
