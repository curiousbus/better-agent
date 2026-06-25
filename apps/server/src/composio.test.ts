import { describe, expect, it } from "vitest";
import { mapComposioResult, mapOpenAiTool } from "./composio";

describe("composio mappers", () => {
	it("maps an OpenAI-format tool to a ComposioToolMeta", () => {
		const meta = mapOpenAiTool({
			type: "function",
			function: {
				name: "HACKERNEWS_SEARCH_POSTS",
				description: "search",
				parameters: { type: "object" },
			},
		});
		expect(meta).toEqual({
			name: "HACKERNEWS_SEARCH_POSTS",
			description: "search",
			parameters: { type: "object" },
		});
	});

	it("defaults missing description/parameters", () => {
		const meta = mapOpenAiTool({ type: "function", function: { name: "X" } });
		expect(meta).toEqual({ name: "X", description: "", parameters: {} });
	});

	it("maps a successful composio result to output", () => {
		expect(
			mapComposioResult({ successful: true, data: { hits: 3 }, error: null })
		).toEqual({
			output: JSON.stringify({ hits: 3 }),
		});
	});

	it("passes through a string-keyed data result as JSON", () => {
		expect(
			mapComposioResult({
				successful: true,
				data: { message: "hello" },
				error: null,
			})
		).toEqual({
			output: JSON.stringify({ message: "hello" }),
		});
	});

	it("maps a failed composio result to an isError output", () => {
		expect(
			mapComposioResult({ successful: false, data: {}, error: "nope" })
		).toEqual({
			output: "nope",
			isError: true,
		});
	});
});
