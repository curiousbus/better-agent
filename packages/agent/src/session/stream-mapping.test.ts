import { describe, expect, it } from "vitest";
import { mapFinishReason, mapUsage } from "./stream-mapping";

describe("mapFinishReason", () => {
	it("passes through the four domain reasons", () => {
		expect(mapFinishReason("stop")).toBe("stop");
		expect(mapFinishReason("length")).toBe("length");
		expect(mapFinishReason("tool-calls")).toBe("tool-calls");
		expect(mapFinishReason("error")).toBe("error");
	});

	it("maps content-filter to error and other to stop", () => {
		expect(mapFinishReason("content-filter")).toBe("error");
		expect(mapFinishReason("other")).toBe("stop");
	});
});

describe("mapUsage basic token counts", () => {
	it("copies token counts and defaults detail fields to null", () => {
		expect(
			mapUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
		).toEqual({
			inputTokens: 10,
			outputTokens: 5,
			totalTokens: 15,
			reasoningTokens: null,
			cacheReadTokens: null,
			cacheWriteTokens: null,
			costCents: null,
		});
	});

	it("maps undefined token counts to null", () => {
		expect(
			mapUsage({
				inputTokens: undefined,
				outputTokens: undefined,
				totalTokens: undefined,
			})
		).toEqual({
			inputTokens: null,
			outputTokens: null,
			totalTokens: null,
			reasoningTokens: null,
			cacheReadTokens: null,
			cacheWriteTokens: null,
			costCents: null,
		});
	});
});

describe("mapUsage detail fields", () => {
	it("maps cache-read and reasoning tokens from inputTokenDetails/outputTokenDetails", () => {
		expect(
			mapUsage({
				inputTokens: 20,
				outputTokens: 8,
				totalTokens: 28,
				inputTokenDetails: {
					noCacheTokens: 15,
					cacheReadTokens: 5,
					cacheWriteTokens: 3,
				},
				outputTokenDetails: { textTokens: 6, reasoningTokens: 2 },
			})
		).toEqual({
			inputTokens: 20,
			outputTokens: 8,
			totalTokens: 28,
			reasoningTokens: 2,
			cacheReadTokens: 5,
			cacheWriteTokens: 3,
			costCents: null,
		});
	});

	it("maps absent inputTokenDetails/outputTokenDetails to null", () => {
		expect(
			mapUsage({
				inputTokens: 10,
				outputTokens: 5,
				totalTokens: 15,
				inputTokenDetails: undefined,
				outputTokenDetails: undefined,
			})
		).toEqual({
			inputTokens: 10,
			outputTokens: 5,
			totalTokens: 15,
			reasoningTokens: null,
			cacheReadTokens: null,
			cacheWriteTokens: null,
			costCents: null,
		});
	});
});
