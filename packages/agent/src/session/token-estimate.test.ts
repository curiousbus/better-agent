import type { ModelMessage } from "ai";
import { expect, it } from "vitest";
import { estimateTokens, exceedsContext } from "./token-estimate";

function msg(content: string): ModelMessage {
	return { role: "user", content };
}

it("estimates roughly chars/4 plus per-message overhead", () => {
	// 8 chars / 4 = 2, + 4 overhead = 6
	expect(estimateTokens([msg("abcdefgh")])).toBe(6);
});

it("sums across messages", () => {
	// (4/4 + 4) + (4/4 + 4) = 5 + 5 = 10
	expect(estimateTokens([msg("aaaa"), msg("bbbb")])).toBe(10);
});

it("handles non-string content by serializing it", () => {
	const m = {
		role: "assistant",
		content: [{ type: "text", text: "hi" }],
	} as ModelMessage;
	expect(estimateTokens([m])).toBeGreaterThan(0);
});

it("exceedsContext is true only above the threshold and with a known limit", () => {
	expect(exceedsContext(81, 100)).toBe(true); // > 100 * 0.8
	expect(exceedsContext(80, 100)).toBe(false); // == threshold, not over
	expect(exceedsContext(99_999, null)).toBe(false); // unknown limit → never
});
