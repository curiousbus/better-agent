import { getKwargs } from "twitter-openapi-typescript";
import type { XClient } from "./x-client";
import { XError, XNotFoundError } from "./x-errors";
import { normalizeProfile, normalizeTweet } from "./x-normalize";
import {
	parseSearchTimeline,
	parseUserTweetsTimeline,
	type RawTimelinePage,
} from "./x-raw-timeline";
import type { NormalizedProfile, NormalizedTweet } from "./x-types";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
export const PAGE_COUNT = 40;

type TweetApi = ReturnType<XClient["getTweetApi"]>;

export function clampLimit(limit: number | undefined): number {
	if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 1) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.trunc(limit), MAX_LIMIT);
}

function isErrorWithStatus(
	err: unknown
): err is { response?: { status?: number } } {
	return typeof err === "object" && err !== null && "response" in err;
}

export function mapError(err: unknown, context: string): Error {
	if (err instanceof XError) {
		return err;
	}
	if (isErrorWithStatus(err) && err.response?.status === 404) {
		return new XNotFoundError(context);
	}
	// Surface the underlying reason — the SDK's status and message — instead of
	// hiding it behind the bare context, so failures are actually diagnosable.
	return new XError(errorDetail(context, err), err);
}

function errorDetail(context: string, err: unknown): string {
	const status = isErrorWithStatus(err) ? err.response?.status : undefined;
	const detail = err instanceof Error ? err.message : String(err);
	const parts = [context];
	if (status !== undefined) {
		parts.push(`status ${status}`);
	}
	if (detail && detail !== context) {
		parts.push(detail);
	}
	return parts.join(" — ");
}

const SNIPPET_LEN = 200;
const WHITESPACE_RE = /\s+/g;

// Read the raw X response as text first, then JSON.parse it. A non-JSON body
// (an X block/challenge page, an empty body, or a compressed/SSE payload on
// Workers) then surfaces as a readable error WITH a snippet of what X actually
// returned — instead of an opaque "Unexpected non-whitespace character" parse
// failure.
export async function readJson(raw: {
	json(): Promise<unknown>;
	text?(): Promise<string>;
}): Promise<unknown> {
	if (typeof raw.text !== "function") {
		return raw.json();
	}
	const body = await raw.text();
	try {
		return JSON.parse(body);
	} catch {
		const snippet = body
			.slice(0, SNIPPET_LEN)
			.replace(WHITESPACE_RE, " ")
			.trim();
		throw new XError(
			`X returned a non-JSON response (${body.length} bytes): ${snippet || "<empty>"}`
		);
	}
}

function normalizeTweets(
	rawTweets: unknown[],
	limit: number
): NormalizedTweet[] {
	const out: NormalizedTweet[] = [];
	for (const raw of rawTweets) {
		if (out.length >= limit) {
			break;
		}
		try {
			out.push(normalizeTweet(raw));
		} catch {
			// Skip one malformed tweet rather than failing the whole page.
		}
	}
	return out;
}

export async function searchUsers(
	client: XClient,
	screenName: string
): Promise<NormalizedProfile> {
	const response = await client
		.getUserApi()
		.getUserByScreenName({ screenName })
		.catch((err: unknown) => {
			throw mapError(err, `getUserByScreenName(${screenName})`);
		});
	const user = response.data.user;
	if (!user) {
		throw new XNotFoundError(`@${screenName} not found`);
	}
	return normalizeProfile(user);
}

// Runs a raw TweetApi timeline call and parses it into tweets. `run` returns the
// raw JSON; `parse` extracts the raw tweet list.
async function runTweetTimeline(
	tweetApi: TweetApi,
	flagKey: keyof TweetApi["flag"],
	kwargs: Record<string, unknown>,
	rawCall: (
		api: TweetApi,
		args: unknown,
		overrides: unknown
	) => Promise<{ raw: { json(): Promise<unknown>; text?(): Promise<string> } }>,
	parse: (json: unknown) => RawTimelinePage,
	context: string,
	limit: number
): Promise<NormalizedTweet[]> {
	const flag = tweetApi.flag[flagKey];
	if (!flag) {
		throw new XError(`${String(flagKey)} flag missing from SDK`);
	}
	const args = getKwargs(flag, kwargs);
	const resp = await rawCall(
		tweetApi,
		args,
		tweetApi.initOverrides(flag)
	).catch((err: unknown) => {
		throw mapError(err, context);
	});
	return normalizeTweets(parse(await readJson(resp.raw)).rawTweets, limit);
}

export function searchTweets(
	client: XClient,
	query: string,
	limit?: number,
	product: "Latest" | "Top" = "Latest"
): Promise<NormalizedTweet[]> {
	return runTweetTimeline(
		client.getTweetApi(),
		"SearchTimeline",
		{ rawQuery: query, product, count: PAGE_COUNT },
		(api, args, overrides) =>
			api.api.getSearchTimelineRaw(args as never, overrides as never),
		parseSearchTimeline,
		`searchTweets(${query})`,
		clampLimit(limit)
	);
}

async function userTimeline(
	client: XClient,
	screenName: string,
	limit: number | undefined,
	flagKey: "UserTweets" | "UserTweetsAndReplies" | "UserMedia" | "Likes",
	rawCall: (
		api: TweetApi,
		args: unknown,
		overrides: unknown
	) => Promise<{ raw: { json(): Promise<unknown>; text?(): Promise<string> } }>
): Promise<NormalizedTweet[]> {
	const profile = await searchUsers(client, screenName);
	return runTweetTimeline(
		client.getTweetApi(),
		flagKey,
		{ userId: profile.twitterUserId, count: PAGE_COUNT },
		rawCall,
		parseUserTweetsTimeline,
		`${flagKey}(${screenName})`,
		clampLimit(limit)
	);
}

export function userTweets(
	client: XClient,
	screenName: string,
	limit?: number
): Promise<NormalizedTweet[]> {
	return userTimeline(client, screenName, limit, "UserTweets", (api, a, o) =>
		api.api.getUserTweetsRaw(a as never, o as never)
	);
}

export function userReplies(
	client: XClient,
	screenName: string,
	limit?: number
): Promise<NormalizedTweet[]> {
	return userTimeline(
		client,
		screenName,
		limit,
		"UserTweetsAndReplies",
		(api, a, o) => api.api.getUserTweetsAndRepliesRaw(a as never, o as never)
	);
}

export function userMedia(
	client: XClient,
	screenName: string,
	limit?: number
): Promise<NormalizedTweet[]> {
	return userTimeline(client, screenName, limit, "UserMedia", (api, a, o) =>
		api.api.getUserMediaRaw(a as never, o as never)
	);
}

export function userLikes(
	client: XClient,
	screenName: string,
	limit?: number
): Promise<NormalizedTweet[]> {
	return userTimeline(client, screenName, limit, "Likes", (api, a, o) =>
		api.api.getLikesRaw(a as never, o as never)
	);
}

export function tweetThread(
	client: XClient,
	tweetId: string,
	limit?: number
): Promise<NormalizedTweet[]> {
	return runTweetTimeline(
		client.getTweetApi(),
		"TweetDetail",
		{ focalTweetId: tweetId },
		(api, args, overrides) =>
			api.api.getTweetDetailRaw(args as never, overrides as never),
		parseUserTweetsTimeline,
		`tweetDetail(${tweetId})`,
		clampLimit(limit)
	);
}
