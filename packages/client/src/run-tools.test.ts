import type { RunEvent } from "@better-agent/agent/session/events";
import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { createUserSessionClientFrom } from "./internal";

function stub(events: RunEvent[], captured: { toolCalls?: unknown }) {
	return {
		userSessions: {
			create: () => Promise.resolve({ id: "s1" }),
			listMessages: () => Promise.resolve([]),
			run: () => Promise.resolve({}),
			prompt: (input: { toolCalls?: unknown }) => {
				captured.toolCalls = input.toolCalls;
				return (function* () {
					for (const e of events) {
						yield e;
					}
				})();
			},
		},
	} as unknown as RouterClient<AppRouter>;
}

it("runTool sends one toolCall and resolves the parsed result", async () => {
	const captured: { toolCalls?: unknown } = {};
	const events: RunEvent[] = [
		{
			type: "tool-result",
			callId: "x",
			name: "listColumn",
			result: JSON.stringify([{ id: "t1" }]),
			isError: false,
		},
		{ type: "done", usage: null, finishReason: "stop" },
	];
	const sdk = createUserSessionClientFrom(stub(events, captured), "agent-1");
	const result = await sdk.runTool("s1", "listColumn", { status: "todo" });
	expect(result).toEqual([{ id: "t1" }]);
	expect(Array.isArray(captured.toolCalls)).toBe(true);
});

it("runTool rejects on an isError result", async () => {
	const events: RunEvent[] = [
		{
			type: "tool-result",
			callId: "x",
			name: "moveTask",
			result: JSON.stringify({ error: "not_found" }),
			isError: true,
		},
		{ type: "done", usage: null, finishReason: "stop" },
	];
	const sdk = createUserSessionClientFrom(stub(events, {}), "agent-1");
	await expect(sdk.runTool("s1", "moveTask", {})).rejects.toThrow();
});
