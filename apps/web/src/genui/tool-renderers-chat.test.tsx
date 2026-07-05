// @vitest-environment jsdom
import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { ToolGroup } from "@better-agent/ui/components/chat/tool";
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { MAX_RENDERED_ITEMS, renderToolResult } from "./tool-renderers";

const TWEET_FIXTURE = {
	authorScreenName: "jack",
	fullText: "hello world from the timeline",
	likeCount: 3,
	media: [],
	postedAt: "2026-01-01T00:00:00.000Z",
	replyCount: 1,
	retweetCount: 2,
	tweetId: "12345",
	viewCount: 99,
};

function mcpEnvelope(payload: unknown, isError = false) {
	return {
		content: [{ text: JSON.stringify(payload), type: "text" }],
		isError,
	};
}

function baseTool(overrides: Partial<ToolInvocation>): ToolInvocation {
	return {
		args: { screen_name: "jack" },
		callId: "c1",
		isError: false,
		result: undefined,
		status: "complete",
		toolName: "x_user_tweets",
		...overrides,
	};
}

// Each test renders its own tool block; queries are scoped to that render's
// `container` (via `within`) rather than the global `screen`, since this repo's
// vitest config doesn't enable test globals — @testing-library/react only
// auto-registers its afterEach(cleanup) when it detects a global `afterEach`,
// so DOM from earlier tests in this file would otherwise still be attached.
function renderTool(tool: ToolInvocation) {
	const { container } = render(
		<ToolGroup renderToolResult={renderToolResult} tools={[tool]} />
	);
	return within(container);
}

it("a registered tool with a successful result renders its rich component", () => {
	const tool = baseTool({ result: mcpEnvelope([TWEET_FIXTURE]) });
	const scope = renderTool(tool);
	fireEvent.click(scope.getByRole("button"));
	expect(scope.getByText(TWEET_FIXTURE.fullText)).toBeDefined();
});

it("an unregistered tool keeps the raw-JSON fallback", () => {
	const tool = baseTool({
		result: "plain fallback text",
		toolName: "some_unregistered_tool",
	});
	const scope = renderTool(tool);
	fireEvent.click(scope.getByRole("button"));
	expect(scope.getByText("plain fallback text")).toBeDefined();
});

it("an errored registered tool shows the error banner, never the rich component", () => {
	const tool = baseTool({
		isError: true,
		result: "boom: tool failed",
		status: "error",
	});
	const scope = renderTool(tool);
	expect(scope.getAllByText("boom: tool failed").length).toBeGreaterThan(0);
	expect(scope.queryByText(TWEET_FIXTURE.fullText)).toBeNull();
});

it("caps a long tweet list at MAX_RENDERED_ITEMS with a +N more line", () => {
	const extra = 5;
	const tweets = Array.from({ length: MAX_RENDERED_ITEMS + extra }, (_, i) => ({
		...TWEET_FIXTURE,
		fullText: `tweet number ${i}`,
		tweetId: String(i),
	}));
	const tool = baseTool({ result: mcpEnvelope(tweets) });
	const scope = renderTool(tool);
	fireEvent.click(scope.getByRole("button"));
	expect(scope.getByText("tweet number 0")).toBeDefined();
	expect(
		scope.getByText(`tweet number ${MAX_RENDERED_ITEMS - 1}`)
	).toBeDefined();
	expect(scope.queryByText(`tweet number ${MAX_RENDERED_ITEMS}`)).toBeNull();
	expect(scope.getByText(`+${extra} more`)).toBeDefined();
});
