// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { LocalAgentUsageRow } from "@/utils/api-types";
import { LocalAgentUsageView } from "./local-agent-usage";

function row(
	agentKind: LocalAgentUsageRow["agentKind"],
	costUsd: number,
	inputTokens: number,
	outputTokens: number,
	turns: number
): LocalAgentUsageRow {
	return {
		agentKind,
		costUsd,
		inputTokens,
		outputTokens,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		turns,
	};
}

const EMPTY_HINT = /No local agent usage yet/i;

const ROWS: LocalAgentUsageRow[] = [
	row("claude-code", 1.25, 800, 400, 3),
	row("opencode", 0, 0, 0, 0),
	row("codex", 0, 0, 0, 0),
	row("pi", 0, 0, 0, 0),
];

it("renders one row per agent kind with its cost and token total", () => {
	const { container } = render(
		<LocalAgentUsageView isEmpty={false} isPending={false} rows={ROWS} />
	);
	const view = within(container);
	expect(view.getByText("Local Agents")).toBeDefined();
	// A row for every kind.
	expect(view.getByText("Claude Code")).toBeDefined();
	expect(view.getByText("opencode")).toBeDefined();
	expect(view.getByText("Codex")).toBeDefined();
	expect(view.getByText("Pi")).toBeDefined();
	// Claude's populated cost + compacted token total (800 + 400 = 1.2k).
	expect(view.getByText("$1.2500")).toBeDefined();
	expect(view.getByText("1.2k")).toBeDefined();
	// A kind with no usage still shows zeros, not a blank.
	expect(view.getAllByText("$0.0000").length).toBeGreaterThan(0);
});

it("shows a hint when no local agent has any usage", () => {
	const { container } = render(
		<LocalAgentUsageView isEmpty={true} isPending={false} rows={ROWS} />
	);
	expect(within(container).getByText(EMPTY_HINT)).toBeDefined();
	expect(within(container).queryByText("Claude Code")).toBeNull();
});
