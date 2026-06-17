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

describe("mapUsage", () => {
	it("copies token counts", () => {
		expect(
			mapUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
		).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
	});

	it("maps undefined token counts to null", () => {
		expect(
			mapUsage({
				inputTokens: undefined,
				outputTokens: undefined,
				totalTokens: undefined,
			})
		).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null });
	});
});
