import { expect, it } from "vitest";
import { createInMemoryPendingToolCallStore } from "./pending-store";
import { buildRemoteToolDefs } from "./remote-tools";

it("builds ToolDefs whose execute parks on the store and resolves via resolve()", async () => {
	const store = createInMemoryPendingToolCallStore();
	const [def] = buildRemoteToolDefs(
		[{ name: "search", description: "d", parameters: { type: "object" } }],
		store
	);
	expect(def?.name).toBe("search");
	const ctx = {
		sessionId: "s1",
		callId: "c1",
		messageId: "m1",
		agentId: "a1",
		abortSignal: new AbortController().signal,
	};
	const running = def?.execute({ q: "x" }, ctx);
	await store.resolve({
		sessionId: "s1",
		callId: "c1",
		result: { output: "FOUND" },
	});
	await expect(running).resolves.toEqual({ output: "FOUND" });
});
