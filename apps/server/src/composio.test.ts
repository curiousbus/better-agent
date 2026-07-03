import { describe, expect, it } from "vitest";
import {
	mapComposioResult,
	mapConnection,
	mapOpenAiTool,
	mapToolkit,
} from "./composio";

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

describe("mapConnection", () => {
	it("maps a connected account and flags ACTIVE", () => {
		expect(
			mapConnection({
				id: "ca_1",
				status: "ACTIVE",
				toolkit: { slug: "gmail" },
			})
		).toEqual({
			id: "ca_1",
			toolkitSlug: "gmail",
			status: "ACTIVE",
			active: true,
		});
	});
	it("flags a non-ACTIVE status as inactive", () => {
		expect(
			mapConnection({
				id: "ca_2",
				status: "INITIATED",
				toolkit: { slug: "slack" },
			}).active
		).toBe(false);
	});
});

describe("mapToolkit", () => {
	it("flags an OAuth toolkit as needing connection", () => {
		expect(
			mapToolkit({
				name: "GitHub",
				slug: "github",
				authSchemes: ["OAUTH2"],
				meta: { description: "d" },
			})
		).toEqual({
			slug: "github",
			name: "GitHub",
			description: "d",
			needsAuth: true,
			authSchemes: ["OAUTH2"],
		});
	});

	it("treats a noAuth toolkit as ready", () => {
		expect(
			mapToolkit({ name: "HN", slug: "hackernews", noAuth: true, meta: {} })
		).toEqual({
			slug: "hackernews",
			name: "HN",
			description: "",
			needsAuth: false,
			authSchemes: [],
		});
	});

	it("treats a NO_AUTH-only scheme as ready and defaults a missing meta", () => {
		expect(
			mapToolkit({ name: "X", slug: "x", authSchemes: ["NO_AUTH"] })
		).toEqual({
			slug: "x",
			name: "X",
			description: "",
			needsAuth: false,
			authSchemes: ["NO_AUTH"],
		});
	});
});
