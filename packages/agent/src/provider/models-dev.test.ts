import { describe, expect, it } from "vitest";
import { parseModelsDev } from "./models-dev";

const SAMPLE = {
	anthropic: {
		id: "anthropic",
		name: "Anthropic",
		npm: "@ai-sdk/anthropic",
		api: "https://api.anthropic.com",
		env: ["ANTHROPIC_API_KEY"],
		models: {
			"claude-opus-4-8": {
				id: "claude-opus-4-8",
				name: "Claude Opus 4.8",
				tool_call: true,
				reasoning: true,
				modalities: { input: ["text", "image"], output: ["text"] },
				cost: { input: 15, output: 75 },
				limit: { context: 200_000, output: 64_000 },
			},
		},
	},
};

describe("parseModelsDev", () => {
	it("normalizes providers and models", () => {
		const { providers, models } = parseModelsDev(SAMPLE);
		expect(providers).toEqual([
			{
				providerId: "anthropic",
				name: "Anthropic",
				npm: "@ai-sdk/anthropic",
				defaultBaseURL: "https://api.anthropic.com",
				envKeys: ["ANTHROPIC_API_KEY"],
			},
		]);
		expect(models[0]).toEqual({
			providerId: "anthropic",
			modelId: "claude-opus-4-8",
			name: "Claude Opus 4.8",
			contextLimit: 200_000,
			maxOutputTokens: 64_000,
			inputPricePerM: 15,
			outputPricePerM: 75,
			capabilities: { toolCall: true, reasoning: true, vision: true },
		});
	});

	it("filters to allowed providers when given", () => {
		const { providers } = parseModelsDev(SAMPLE, ["openai"]);
		expect(providers).toEqual([]);
	});
});
