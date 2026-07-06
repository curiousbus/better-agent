import { expect, it, vi } from "vitest";
import { claudeCodeAdapter } from "./claude-code";
import { mockQuery } from "./claude-code-test-harness";

// Phase 4: the claude-code adapter applies the bridge token's persisted
// startup config (appendSystemPrompt + maxTurns) at query() time. Split out
// of claude-code.test.ts to keep that file under the 300-line limit.

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	listSessions: vi.fn(),
}));

it("applies startup config: appends to the system prompt and caps maxTurns", async () => {
	const { harness } = mockQuery();
	await claudeCodeAdapter.start("/tmp/project", {
		config: { appendSystemPrompt: "Always cite the file.", maxTurns: 12 },
	});

	expect(harness.options).toMatchObject({
		maxTurns: 12,
		systemPrompt: {
			append: "Always cite the file.",
			preset: "claude_code",
			type: "preset",
		},
	});
});

it("omits systemPrompt when no appendSystemPrompt is configured", async () => {
	const { harness } = mockQuery();
	await claudeCodeAdapter.start("/tmp/project", { config: { maxTurns: 5 } });

	expect(harness.options?.systemPrompt).toBeUndefined();
	expect(harness.options).toMatchObject({ maxTurns: 5 });
});
