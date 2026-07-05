import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import {
	latestSessionReadyDetail,
	latestTurnUsageDetail,
} from "./bridge-session-status";

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

it("returns null when no session_ready event has arrived", () => {
	expect(latestSessionReadyDetail([])).toBeNull();
	expect(
		latestSessionReadyDetail([ev(1, { kind: "status", status: "starting" })])
	).toBeNull();
});

it("parses the latest session_ready detail, ignoring an earlier one", () => {
	const events: StreamEvent[] = [
		ev(1, {
			kind: "status",
			status: "session_ready",
			detail: { model: "old-model" },
		}),
		ev(2, {
			kind: "status",
			status: "session_ready",
			detail: {
				model: "claude-opus-4-6",
				cwd: "/repo",
				permissionMode: "acceptEdits",
				tools: ["Bash"],
				mcpServers: [{ name: "docs", status: "connected" }],
			},
		}),
	];
	expect(latestSessionReadyDetail(events)).toEqual({
		model: "claude-opus-4-6",
		cwd: "/repo",
		permissionMode: "acceptEdits",
		tools: ["Bash"],
		slashCommands: undefined,
		skills: undefined,
		mcpServers: [{ name: "docs", status: "connected" }],
	});
});

it("returns null when no turn_usage event has arrived", () => {
	expect(latestTurnUsageDetail([])).toBeNull();
});

it("parses the latest turn_usage detail", () => {
	const events: StreamEvent[] = [
		ev(1, {
			kind: "status",
			status: "turn_usage",
			detail: {
				costUsd: 0.012_345,
				numTurns: 2,
				durationMs: 1000,
				usage: { inputTokens: 100, outputTokens: 50 },
				isError: false,
			},
		}),
	];
	expect(latestTurnUsageDetail(events)).toEqual({
		costUsd: 0.012_345,
		numTurns: 2,
		durationMs: 1000,
		usage: {
			inputTokens: 100,
			outputTokens: 50,
			cacheReadInputTokens: undefined,
			cacheCreationInputTokens: undefined,
		},
		isError: false,
	});
});

it("returns null (not a thrown error) for a malformed detail", () => {
	const events: StreamEvent[] = [
		ev(1, { kind: "status", status: "session_ready", detail: "not-an-object" }),
	];
	expect(latestSessionReadyDetail(events)).toBeNull();
});
