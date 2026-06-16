import { describe, expect, it } from "vitest";
import { loadAdapter } from "./adapter-loader";

const BASE_URL_ERROR_PATTERN = /baseURL/;

describe("loadAdapter", () => {
	it("builds a native anthropic model", async () => {
		const make = await loadAdapter("@ai-sdk/anthropic", {
			apiKey: "sk-test",
			baseURL: null,
		});
		const model = make("claude-opus-4-8");
		expect(model.modelId).toBe("claude-opus-4-8");
	});

	it("falls back to openai-compatible for unknown npm", async () => {
		const make = await loadAdapter("@some/unknown-provider", {
			apiKey: "sk-test",
			baseURL: "https://example.com/v1",
		});
		const model = make("custom-model");
		expect(model.modelId).toBe("custom-model");
	});

	it("throws when fallback has no baseURL", async () => {
		await expect(
			loadAdapter("@some/unknown-provider", { apiKey: "k", baseURL: null })
		).rejects.toThrow(BASE_URL_ERROR_PATTERN);
	});
});
