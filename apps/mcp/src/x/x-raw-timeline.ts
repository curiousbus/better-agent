// Walks the raw X GraphQL UserTweets JSON instead of the generated SDK's typed
// deserializer. The SDK marks many array fields as required and calls `.map`
// without null guards, so a single omitted field (which X does regularly)
// crashes the whole page before our normalizer runs. Reading the raw JSON
// ourselves keeps a missing field local to one tweet instead of fatal.

type AnyRecord = Record<string, unknown>;

export interface RawTimelinePage {
	bottomCursor: string | null;
	rawTweets: unknown[];
}

function asRecord(v: unknown): AnyRecord | null {
	return typeof v === "object" && v !== null ? (v as AnyRecord) : null;
}

function asArray(v: unknown): unknown[] {
	return Array.isArray(v) ? v : [];
}

// tweet_results.result is a TweetUnion discriminated by __typename.
function unwrapTweetResult(result: unknown): unknown {
	const rec = asRecord(result);
	if (!rec) {
		return null;
	}
	if (rec.__typename === "Tweet") {
		return rec;
	}
	if (rec.__typename === "TweetWithVisibilityResults") {
		return asRecord(rec.tweet);
	}
	// TweetTombstone / TweetUnavailable / TweetPreviewDisplay / unknown → skip
	return null;
}

function tweetFromItemContent(itemContent: unknown): unknown {
	const rec = asRecord(itemContent);
	if (rec?.itemType !== "TimelineTweet") {
		return null;
	}
	const results = asRecord(rec.tweet_results);
	if (!results) {
		return null;
	}
	return unwrapTweetResult(results.result);
}

function bottomCursorFrom(content: AnyRecord): string | null {
	if (content.cursorType === "Bottom" && typeof content.value === "string") {
		return content.value;
	}
	const itemContent = asRecord(content.itemContent);
	if (
		itemContent &&
		itemContent.cursorType === "Bottom" &&
		typeof itemContent.value === "string"
	) {
		return itemContent.value;
	}
	return null;
}

function collectModuleItems(moduleItems: unknown, out: unknown[]): void {
	for (const moduleItem of asArray(moduleItems)) {
		const itemContent = asRecord(asRecord(moduleItem)?.item)?.itemContent;
		const tweet = tweetFromItemContent(itemContent);
		if (tweet) {
			out.push(tweet);
		}
	}
}

// Pushes any tweets found in an entry into `out`; returns a bottom cursor value
// if the entry is one.
function collectFromEntry(entry: unknown, out: unknown[]): string | null {
	const content = asRecord(asRecord(entry)?.content);
	if (!content) {
		return null;
	}
	const cursor = bottomCursorFrom(content);
	if (cursor) {
		return cursor;
	}
	if (content.entryType === "TimelineTimelineItem") {
		const tweet = tweetFromItemContent(content.itemContent);
		if (tweet) {
			out.push(tweet);
		}
	} else if (content.entryType === "TimelineTimelineModule") {
		collectModuleItems(content.items, out);
	}
	return null;
}

// Returns a bottom cursor value if the instruction contained one.
function collectFromInstruction(
	inst: AnyRecord,
	out: unknown[]
): string | null {
	if (inst.type === "TimelineAddEntries") {
		let cursor: string | null = null;
		for (const entry of asArray(inst.entries)) {
			cursor = collectFromEntry(entry, out) ?? cursor;
		}
		return cursor;
	}
	if (inst.type === "TimelineAddToModule") {
		collectModuleItems(inst.moduleItems, out);
		return null;
	}
	if (inst.type === "TimelineReplaceEntry") {
		collectFromEntry(inst.entry, out);
	}
	return null;
}

function instructionsFrom(json: unknown): unknown[] {
	const result = asRecord(
		asRecord(asRecord(asRecord(json)?.data)?.user)?.result
	);
	if (!result) {
		return [];
	}
	const container = asRecord(result.timeline_v2) ?? asRecord(result.timeline);
	const instructions = asRecord(asRecord(container)?.timeline)?.instructions;
	return asArray(instructions);
}

// Search results live under a different top-level path than a user timeline:
// data.search_by_raw_query.search_timeline.timeline.instructions.
function searchInstructionsFrom(json: unknown): unknown[] {
	const search = asRecord(asRecord(asRecord(json)?.data)?.search_by_raw_query);
	const timeline = asRecord(asRecord(search?.search_timeline)?.timeline);
	return asArray(timeline?.instructions);
}

function walkInstructions(instructions: unknown[]): RawTimelinePage {
	const rawTweets: unknown[] = [];
	let bottomCursor: string | null = null;
	for (const instruction of instructions) {
		const inst = asRecord(instruction);
		if (!inst) {
			continue;
		}
		bottomCursor = collectFromInstruction(inst, rawTweets) ?? bottomCursor;
	}
	return { rawTweets, bottomCursor };
}

export function parseUserTweetsTimeline(json: unknown): RawTimelinePage {
	return walkInstructions(instructionsFrom(json));
}

export function parseSearchTimeline(json: unknown): RawTimelinePage {
	return walkInstructions(searchInstructionsFrom(json));
}

// User-list timelines (followers/following/retweeters) carry TimelineUser
// items whose user object lives at itemContent.user_results.result.
function userFromItemContent(itemContent: unknown): unknown {
	const rec = asRecord(itemContent);
	if (rec?.itemType !== "TimelineUser") {
		return null;
	}
	const result = asRecord(asRecord(rec.user_results)?.result);
	return result && result.__typename === "User" ? result : null;
}

function collectUsersFromInstruction(inst: AnyRecord, out: unknown[]): void {
	if (inst.type !== "TimelineAddEntries") {
		return;
	}
	for (const entry of asArray(inst.entries)) {
		const content = asRecord(asRecord(entry)?.content);
		if (content?.entryType === "TimelineTimelineItem") {
			const user = userFromItemContent(content.itemContent);
			if (user) {
				out.push(user);
			}
		}
	}
}

export function parseUserListTimeline(json: unknown): unknown[] {
	const out: unknown[] = [];
	for (const instruction of instructionsFrom(json)) {
		const inst = asRecord(instruction);
		if (inst) {
			collectUsersFromInstruction(inst, out);
		}
	}
	return out;
}
