import { expect, it } from "vitest";
import {
	deriveLocalAgentStatus,
	LOCAL_AGENT_LIVE_THRESHOLD_MS,
} from "./local-agent-status";

const NOW = new Date("2026-07-04T12:00:00Z");
const FAR_PAST_MULTIPLIER = 10;

it("is ended when the row's status is ended, no matter how recent lastSeenAt is", () => {
	expect(
		deriveLocalAgentStatus({ status: "ended", lastSeenAt: NOW }, NOW)
	).toBe("ended");
});

it("is live just under the threshold", () => {
	const lastSeenAt = new Date(
		NOW.getTime() - (LOCAL_AGENT_LIVE_THRESHOLD_MS - 1)
	);
	expect(deriveLocalAgentStatus({ status: "active", lastSeenAt }, NOW)).toBe(
		"live"
	);
});

it("is idle exactly at the threshold — live is a strict less-than", () => {
	const lastSeenAt = new Date(NOW.getTime() - LOCAL_AGENT_LIVE_THRESHOLD_MS);
	expect(deriveLocalAgentStatus({ status: "active", lastSeenAt }, NOW)).toBe(
		"idle"
	);
});

it("is idle well past the threshold", () => {
	const lastSeenAt = new Date(
		NOW.getTime() - LOCAL_AGENT_LIVE_THRESHOLD_MS * FAR_PAST_MULTIPLIER
	);
	expect(deriveLocalAgentStatus({ status: "active", lastSeenAt }, NOW)).toBe(
		"idle"
	);
});
