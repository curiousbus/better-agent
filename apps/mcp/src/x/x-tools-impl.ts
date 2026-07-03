import { getKwargs } from "twitter-openapi-typescript";
import type { XClient } from "./x-client";
import { XError, XNotFoundError } from "./x-errors";
import { normalizeProfile, normalizeTweet } from "./x-normalize";
import { parseSearchTimeline, parseUserTweetsTimeline } from "./x-raw-timeline";
import type { NormalizedProfile, NormalizedTweet } from "./x-types";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const PAGE_COUNT = 40;

function clampLimit(limit: number | undefined): number {
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

function mapError(err: unknown, context: string): Error {
	if (err instanceof XError) {
		return err;
	}
	if (isErrorWithStatus(err) && err.response?.status === 404) {
		return new XNotFoundError(context);
	}
	return new XError(context, err);
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

function normalizePage(rawTweets: unknown[], limit: number): NormalizedTweet[] {
	const out: NormalizedTweet[] = [];
	for (const raw of rawTweets) {
		if (out.length >= limit) {
			break;
		}
		try {
			out.push(normalizeTweet(raw));
		} catch {
			// Skip a single malformed tweet rather than failing the whole page.
		}
	}
	return out;
}

export async function searchTweets(
	client: XClient,
	query: string,
	limit?: number
): Promise<NormalizedTweet[]> {
	const capped = clampLimit(limit);
	const tweetApi = client.getTweetApi();
	const flag = tweetApi.flag.SearchTimeline;
	if (!flag) {
		throw new XError("SearchTimeline flag missing from SDK");
	}
	const args = getKwargs(flag, {
		rawQuery: query,
		product: "Latest",
		count: PAGE_COUNT,
	});
	const resp = await tweetApi.api
		.getSearchTimelineRaw(args, tweetApi.initOverrides(flag))
		.catch((err: unknown) => {
			throw mapError(err, `searchTweets(${query})`);
		});
	const json: unknown = await resp.raw.json();
	return normalizePage(parseSearchTimeline(json).rawTweets, capped);
}

export async function userTweets(
	client: XClient,
	screenName: string,
	limit?: number
): Promise<NormalizedTweet[]> {
	const capped = clampLimit(limit);
	const profile = await searchUsers(client, screenName);
	const tweetApi = client.getTweetApi();
	const flag = tweetApi.flag.UserTweets;
	if (!flag) {
		throw new XError("UserTweets flag missing from SDK");
	}
	const args = getKwargs(flag, {
		userId: profile.twitterUserId,
		count: PAGE_COUNT,
	});
	const resp = await tweetApi.api
		.getUserTweetsRaw(args, tweetApi.initOverrides(flag))
		.catch((err: unknown) => {
			throw mapError(err, `userTweets(${screenName})`);
		});
	const json: unknown = await resp.raw.json();
	return normalizePage(parseUserTweetsTimeline(json).rawTweets, capped);
}
