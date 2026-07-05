import type { ReactNode } from "react";
import type { ZodType } from "zod";
import { unwrapToolResult } from "./tool-result-envelope";
import { TweetCardFromTweet } from "./tweet-card-node";
import { UserCard } from "./user-card";
import {
	type NormalizedProfileData,
	NormalizedProfileSchema,
	type ProfileListData,
	ProfileListSchema,
	type TweetListData,
	TweetListSchema,
} from "./x-result-schemas";

/** Long tool results (a search returning dozens of tweets) render at most
 * this many items, plus a "+N more" line — the chat pane isn't a timeline. */
export const MAX_RENDERED_ITEMS = 20;

interface ToolResultRenderer {
	/** Parses a raw tool-result value (see unwrapToolResult) into render-ready
	 * data, or null when it doesn't match this tool's expected shape. */
	parse(result: unknown): unknown;
	render(data: unknown): ReactNode;
}

// `data as T` below is a closed type-erasure box: `parse` and `render` are
// always built from the SAME schema/render pair in `entry`, so the cast can
// never see a mismatched value — there's no `unknown`-typed public API that
// lets a caller mix parse output from one entry with render from another.
function entry<T>(
	schema: ZodType<T>,
	render: (data: T) => ReactNode
): ToolResultRenderer {
	return {
		parse: (result: unknown) => {
			const parsed = schema.safeParse(unwrapToolResult(result));
			return parsed.success ? parsed.data : null;
		},
		render: (data: unknown) => render(data as T),
	};
}

function ItemList<T>({
	items,
	renderItem,
}: {
	items: T[];
	renderItem: (item: T) => ReactNode;
}) {
	const visible = items.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = items.length - visible.length;
	return (
		<div className="flex flex-col gap-2">
			{visible.map(renderItem)}
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</div>
	);
}

function renderTweetList(tweets: TweetListData): ReactNode {
	return (
		<ItemList
			items={tweets}
			renderItem={(tweet) => (
				<TweetCardFromTweet key={tweet.tweetId} tweet={tweet} />
			)}
		/>
	);
}

function renderProfileList(profiles: ProfileListData): ReactNode {
	return (
		<ItemList
			items={profiles}
			renderItem={(profile) => (
				<UserCard key={profile.screenName} profile={profile} />
			)}
		/>
	);
}

function renderSingleProfile(profile: NormalizedProfileData): ReactNode {
	return <UserCard profile={profile} />;
}

const TWEET_LIST_TOOLS = [
	"x_search_tweets",
	"x_user_tweets",
	"x_user_replies",
	"x_user_likes",
	"x_tweet_thread",
	"x_user_media",
] as const;

const PROFILE_LIST_TOOLS = ["x_followers", "x_following"] as const;

function tweetListEntries(): [string, ToolResultRenderer][] {
	return TWEET_LIST_TOOLS.map((name) => [
		name,
		entry<TweetListData>(TweetListSchema, renderTweetList),
	]);
}

function profileListEntries(): [string, ToolResultRenderer][] {
	return PROFILE_LIST_TOOLS.map((name) => [
		name,
		entry<ProfileListData>(ProfileListSchema, renderProfileList),
	]);
}

/** Tool name → { parse, render } for tools with a rich chat-result component.
 * Unregistered tool names simply have no entry — callers fall back to the
 * existing raw-JSON tool block. */
export const TOOL_RESULT_RENDERERS: Record<string, ToolResultRenderer> = {
	...Object.fromEntries(tweetListEntries()),
	...Object.fromEntries(profileListEntries()),
	x_search_users: entry<NormalizedProfileData>(
		NormalizedProfileSchema,
		renderSingleProfile
	),
};

/** The `renderToolResult` hook threaded into the chat UI: null/undefined
 * means "no rich render available" — the tool block keeps its raw-JSON UI. */
export function renderToolResult(
	toolName: string,
	result: unknown
): ReactNode | null {
	const renderer = TOOL_RESULT_RENDERERS[toolName];
	if (!renderer) {
		return null;
	}
	const data = renderer.parse(result);
	return data === null ? null : renderer.render(data);
}
