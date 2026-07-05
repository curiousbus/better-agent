import type { LocalAgentEntry } from "./local-agent-join";

/** Formats a session timestamp (`createdAt`/`lastSeenAt`) using the
 * browser's locale — shared by the list cards and the detail header so the
 * two surfaces never drift into different date formats. */
export function formatSessionTimestamp(value: Date): string {
	return new Date(value).toLocaleString();
}

const UNTITLED_LOCAL_AGENT = "Untitled";

/** The display name for a local agent: its token's `name`, falling back to the
 * latest session's `label`, then a generic placeholder. Shared by the list
 * card and the detail header so the two never disagree on what to call it. */
export function localAgentDisplayName(entry: LocalAgentEntry): string {
	return entry.token.name ?? entry.latestSession?.label ?? UNTITLED_LOCAL_AGENT;
}
