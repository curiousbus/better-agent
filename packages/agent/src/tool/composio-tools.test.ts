import { describe, expect, it } from "vitest";
import { buildComposioToolDefs, type ComposioService } from "./composio-tools";

const EXEC_CTX = {
	abortSignal: new AbortController().signal,
	agentId: "a",
	callId: "c",
	messageId: "m",
	sessionId: "s",
} as const;

function fakeService(over: Partial<ComposioService> = {}): ComposioService {
	return {
		listToolkits: () => Promise.resolve([]),
		listTools: (_userId, _toolkits) =>
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
		const defs = await buildComposioToolDefs(fakeService(), "user-1", []);
		expect(defs).toHaveLength(1);
		expect(defs[0]?.name).toBe("HACKERNEWS_SEARCH_POSTS");
		const result = await defs[0]?.execute({ query: "ts" }, EXEC_CTX);
		expect(result?.output).toContain("HACKERNEWS_SEARCH_POSTS");
		expect(result?.output).toContain("user-1");
	});

	it("preserves an isError result from the service", async () => {
		const defs = await buildComposioToolDefs(
			fakeService({
				execute: () => Promise.resolve({ output: "boom", isError: true }),
			}),
			"user-1",
			[]
		);
		const result = await defs[0]?.execute({}, EXEC_CTX);
		expect(result).toEqual({ output: "boom", isError: true });
	});

	it("returns an empty list when the service lists no tools", async () => {
		const defs = await buildComposioToolDefs(
			fakeService({ listTools: (_u, _t) => Promise.resolve([]) }),
			"user-1",
			[]
		);
		expect(defs).toEqual([]);
	});

	it("forwards the toolkits arg to service.listTools", async () => {
		const captured: string[][] = [];
		const service = fakeService({
			listTools: (_userId, toolkits) => {
				captured.push(toolkits);
				return Promise.resolve([]);
			},
		});
		await buildComposioToolDefs(service, "user-1", ["hackernews"]);
		expect(captured).toEqual([["hackernews"]]);
	});
});
