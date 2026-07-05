import type { BridgeSessionRow } from "@/utils/api-types";

/** A session counts as "live" while its last heartbeat is within this many
 * ms — past that it's just "idle" (token/session still open, CLI likely
 * stalled or between turns) until it's explicitly ended. */
export const LOCAL_AGENT_LIVE_THRESHOLD_MS = 30_000;

export type LocalAgentStatus = "ended" | "idle" | "live";

/** Derives the display status of a bridge session: `ended` once the row is
 * marked ended (regardless of how recently it was seen), otherwise `live` if
 * its last heartbeat is within `LOCAL_AGENT_LIVE_THRESHOLD_MS`, else `idle`.
 * `now` is injectable for deterministic tests. */
export function deriveLocalAgentStatus(
	session: Pick<BridgeSessionRow, "lastSeenAt" | "status">,
	now: Date = new Date()
): LocalAgentStatus {
	if (session.status === "ended") {
		return "ended";
	}
	const elapsedMs = now.getTime() - new Date(session.lastSeenAt).getTime();
	return elapsedMs < LOCAL_AGENT_LIVE_THRESHOLD_MS ? "live" : "idle";
}
