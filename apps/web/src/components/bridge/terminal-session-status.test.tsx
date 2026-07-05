// @vitest-environment jsdom
import { render, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { Terminal } from "./terminal";
import { makeControllableTransport, SESSION } from "./terminal-test-helpers";

// Phase 2: the curated `session_ready` and `turn_usage` status events carry
// session metadata (capabilities, cost/tokens) and must render as dedicated
// header/chip UI — never as an inline chat row (see bridge-turns.ts,
// session-status-header.tsx, turn-usage-chip.tsx). Seeded via
// `transport.history` (like terminal-history.test.tsx) since these render
// as soon as the feed is seeded, with no live SSE interaction needed.

const SESSION_READY_DETAIL = {
	model: "claude-opus-4-6",
	cwd: "/Users/john/project",
	permissionMode: "acceptEdits",
	tools: ["Bash", "Read", "Edit"],
	slashCommands: ["/compact", "/clear"],
	skills: ["web-design"],
	mcpServers: [
		{ name: "docs", status: "connected" },
		{ name: "search", status: "failed" },
	],
};

const TURN_USAGE_DETAIL = {
	costUsd: 0.012_345,
	numTurns: 3,
	durationMs: 4500,
	usage: { inputTokens: 1234, outputTokens: 567 },
	isError: false,
};

it("renders session_ready as the status header, not a chat row", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: {
				kind: "status",
				status: "session_ready",
				detail: SESSION_READY_DETAIL,
			},
		},
	]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	const view = within(container);

	await waitFor(() => {
		expect(view.getByText("claude-opus-4-6")).toBeDefined();
	});
	expect(view.getByText("acceptEdits")).toBeDefined();
	expect(view.getByText("3 tools · 2 commands · 1 skills")).toBeDefined();
	expect(view.getByTitle("docs: connected")).toBeDefined();
	expect(view.getByTitle("search: failed")).toBeDefined();
	// This is metadata, not a message: the raw status name must never appear
	// anywhere on the page (it used to, via the generic StatusLine).
	expect(view.queryByText("session_ready")).toBeNull();
});

it("renders turn_usage as the usage chip, not a chat row", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: {
				kind: "status",
				status: "turn_usage",
				detail: TURN_USAGE_DETAIL,
			},
		},
	]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	const view = within(container);

	await waitFor(() => {
		expect(view.getByText("$0.0123")).toBeDefined();
	});
	expect(view.getByText("1.2k in / 567 out")).toBeDefined();
	expect(view.getByText("3 turns")).toBeDefined();
	expect(view.queryByText("turn_usage")).toBeNull();
});

it("still renders a normal assistant message as a chat bubble", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: { kind: "message", role: "assistant", text: "Hello there" },
		},
	]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	const view = within(container);

	await waitFor(() => {
		expect(view.getByText("Hello there")).toBeDefined();
	});
});
