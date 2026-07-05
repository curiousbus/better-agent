import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import {
	latestSessionListDetail,
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

it("parses the claude session id off a session_ready detail", () => {
	const events: StreamEvent[] = [
		ev(1, {
			kind: "status",
			status: "session_ready",
			detail: { model: "claude-opus-4-6", sessionId: "claude-session-xyz" },
		}),
	];
	expect(latestSessionReadyDetail(events)?.sessionId).toBe(
		"claude-session-xyz"
	);
});

it("returns null when no session_list event has arrived", () => {
	expect(latestSessionListDetail([])).toBeNull();
});

it("parses the latest session_list detail's sessions", () => {
	const events: StreamEvent[] = [
		ev(1, {
			kind: "status",
			status: "session_list",
			detail: {
				sessions: [
					{
						id: "sess-1",
						title: "Fix the login bug",
						lastModified: 1_700_000_000_000,
						gitBranch: "main",
						cwd: "/repo",
					},
				],
			},
		}),
	];
	expect(latestSessionListDetail(events)).toEqual({
		sessions: [
			{
				id: "sess-1",
				title: "Fix the login bug",
				lastModified: 1_700_000_000_000,
				gitBranch: "main",
				cwd: "/repo",
			},
		],
	});
});

it("drops a session_list entry missing its id, keeping well-formed ones", () => {
	const events: StreamEvent[] = [
		ev(1, {
			kind: "status",
			status: "session_list",
			detail: {
				sessions: [{ title: "no id, dropped" }, { id: "sess-2", title: "ok" }],
			},
		}),
	];
	expect(latestSessionListDetail(events)).toEqual({
		sessions: [{ id: "sess-2", title: "ok" }],
	});
});
