import { describe, expect, it } from "vitest";
import { buildComposioToolDefs, type ComposioService } from "./composio-tools";

function fakeService(over: Partial<ComposioService> = {}): ComposioService {
	return {
		listTools: () =>
			Promise.resolve([
				{
					name: "HACKERNEWS_SEARCH_POSTS",
					description: "search HN",
					parameters: { type: "object" },
				},
			]),
		execute: ({ toolName, userId, args }) =>
			Promise.resolve({
				output: `ran ${toolName} for ${userId} with ${JSON.stringify(args)}`,
			}),
		...over,
	};
}

describe("buildComposioToolDefs", () => {
	it("maps listed tools to ToolDefs that forward execute to the service", async () => {
		const defs = await buildComposioToolDefs(fakeService(), "user-1");
		expect(defs).toHaveLength(1);
		expect(defs[0]?.name).toBe("HACKERNEWS_SEARCH_POSTS");
		const ctx = {
			abortSignal: new AbortController().signal,
			agentId: "a",
			callId: "c",
			messageId: "m",
			sessionId: "s",
		};
		const result = await defs[0]?.execute({ query: "ts" }, ctx);
		expect(result?.output).toContain("HACKERNEWS_SEARCH_POSTS");
		expect(result?.output).toContain("user-1");
	});

	it("preserves an isError result from the service", async () => {
		const defs = await buildComposioToolDefs(
			fakeService({
				execute: () => Promise.resolve({ output: "boom", isError: true }),
			}),
			"user-1"
		);
		const ctx = {
			abortSignal: new AbortController().signal,
			agentId: "a",
			callId: "c",
			messageId: "m",
			sessionId: "s",
		};
		const result = await defs[0]?.execute({}, ctx);
		expect(result).toEqual({ output: "boom", isError: true });
	});

	it("returns an empty list when the service lists no tools", async () => {
		const defs = await buildComposioToolDefs(
			fakeService({ listTools: () => Promise.resolve([]) }),
			"user-1"
		);
		expect(defs).toEqual([]);
	});
});
