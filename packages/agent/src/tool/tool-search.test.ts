import { describe, expect, it } from "vitest";
import {
	buildDeferredBinding,
	DEFER_THRESHOLD,
	rankTools,
	SEARCH_TOOL_NAME,
	shouldDefer,
} from "./tool-search";
import type { ToolDef } from "./types";

const CTX = {
	abortSignal: new AbortController().signal,
	agentId: "a",
	callId: "c",
	messageId: "m",
	sessionId: "s",
} as const;

function def(name: string, description: string, defer = true): ToolDef {
	return {
		name,
		description,
		defer,
		parameters: { type: "object" },
		execute: () => Promise.resolve({ output: `ran ${name}` }),
	};
}

describe("rankTools", () => {
	it("ranks name matches above description matches", () => {
		const tools = [
			def("GMAIL_SEND_EMAIL", "Send an email via Gmail"),
			def("TWITTER_SEARCH", "Search posts. Can also find email addresses."),
		];
		const ranked = rankTools(tools, "send email");
		expect(ranked[0]?.name).toBe("GMAIL_SEND_EMAIL");
	});

	it("returns nothing for an unrelated query", () => {
		const tools = [def("GMAIL_SEND_EMAIL", "Send an email")];
		expect(rankTools(tools, "weather forecast")).toEqual([]);
	});
});

describe("shouldDefer", () => {
	it("only defers past the threshold of defer-marked tools", () => {
		const many = Array.from({ length: DEFER_THRESHOLD + 1 }, (_, i) =>
			def(`TOOL_${i}`, "d")
		);
		expect(shouldDefer(many)).toBe(true);
		expect(shouldDefer(many.slice(1))).toBe(false);
		const nonDefer = many.map((d) => ({ ...d, defer: false }));
		expect(shouldDefer(nonDefer)).toBe(false);
	});
});

describe("buildDeferredBinding", () => {
	it("hides deferred tools until a search surfaces them", async () => {
		const defs = [
			def("ALWAYS_ON", "core tool", false),
			def("GMAIL_SEND_EMAIL", "Send an email via Gmail"),
			def("TWITTER_SEARCH", "Search tweets"),
		];
		const binding = buildDeferredBinding(defs);
		expect(binding.activeNames().sort()).toEqual([
			"ALWAYS_ON",
			SEARCH_TOOL_NAME,
		]);

		const search = binding.defs.find((d) => d.name === SEARCH_TOOL_NAME);
		const result = await search?.execute({ query: "send an email" }, CTX);
		expect(result?.output).toContain("GMAIL_SEND_EMAIL");
		expect(binding.activeNames()).toContain("GMAIL_SEND_EMAIL");
		// Unrelated tools stay hidden.
		expect(binding.activeNames()).not.toContain("TWITTER_SEARCH");
	});

	it("reports no matches without activating anything", async () => {
		const binding = buildDeferredBinding([def("GMAIL_SEND_EMAIL", "email")]);
		const search = binding.defs.find((d) => d.name === SEARCH_TOOL_NAME);
		const result = await search?.execute({ query: "zzz qqq" }, CTX);
		expect(result?.output).toContain("No tools matched");
		expect(binding.activeNames()).toEqual([SEARCH_TOOL_NAME]);
	});
});
