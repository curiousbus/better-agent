import { getKwargs } from "twitter-openapi-typescript";
import type { XClient } from "./x-client";
import { XError } from "./x-errors";
import { normalizeProfile } from "./x-normalize";
import { parseUserListTimeline } from "./x-raw-timeline";
import {
	clampLimit,
	mapError,
	PAGE_COUNT,
	readJson,
	searchUsers,
} from "./x-tools-impl";
import type { NormalizedProfile } from "./x-types";

type UserListApi = ReturnType<XClient["getUserListApi"]>;

function normalizeProfiles(
	rawUsers: unknown[],
	limit: number
): NormalizedProfile[] {
	const out: NormalizedProfile[] = [];
	for (const raw of rawUsers) {
		if (out.length >= limit) {
			break;
		}
		try {
			out.push(normalizeProfile(raw));
		} catch {
			// Skip one malformed user.
		}
	}
	return out;
}

async function userList(
	client: XClient,
	screenName: string,
	limit: number | undefined,
	flagKey: "Followers" | "Following",
	rawCall: (
		api: UserListApi,
		args: unknown,
		overrides: unknown
	) => Promise<{ raw: { json(): Promise<unknown>; text?(): Promise<string> } }>
): Promise<NormalizedProfile[]> {
	const profile = await searchUsers(client, screenName);
	const listApi = client.getUserListApi();
	const flag = listApi.flag[flagKey];
	if (!flag) {
		throw new XError(`${flagKey} flag missing from SDK`);
	}
	const args = getKwargs(flag, {
		userId: profile.twitterUserId,
		count: PAGE_COUNT,
	});
	const resp = await rawCall(listApi, args, listApi.initOverrides(flag)).catch(
		(err: unknown) => {
			throw mapError(err, `${flagKey}(${screenName})`);
		}
	);
	return normalizeProfiles(
		parseUserListTimeline(await readJson(resp.raw)),
		clampLimit(limit)
	);
}

export function followers(
	client: XClient,
	screenName: string,
	limit?: number
): Promise<NormalizedProfile[]> {
	return userList(client, screenName, limit, "Followers", (api, a, o) =>
		api.api.getFollowersRaw(a as never, o as never)
	);
}

export function following(
	client: XClient,
	screenName: string,
	limit?: number
): Promise<NormalizedProfile[]> {
	return userList(client, screenName, limit, "Following", (api, a, o) =>
		api.api.getFollowingRaw(a as never, o as never)
	);
}
