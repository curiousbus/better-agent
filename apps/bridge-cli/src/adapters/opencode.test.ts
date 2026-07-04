import { describe, expect, it, vi } from "vitest";
import type { JsonRpcIo } from "./jsonrpc-io";
import { connectJsonRpc } from "./jsonrpc-io";
import { opencodeAdapter } from "./opencode";
import type { ProcessExitInfo } from "./process-io";

vi.mock("./jsonrpc-io", () => ({ connectJsonRpc: vi.fn() }));

/** A fake `JsonRpcIo` whose exit can be triggered on demand by the test,
 * standing in for the real `opencode acp` process opencode.ts spawns. */
function createFakeRpc(): {
	rpc: JsonRpcIo;
	triggerExit(info: ProcessExitInfo): void;
} {
	const exitHandlers: Array<(info: ProcessExitInfo) => void> = [];
	return {
		rpc: {
			notify: vi.fn(),
			onExit: (handler) => exitHandlers.push(handler),
			onNotification: vi.fn(),
			request: (method: string) => {
				if (method === "session/new") {
					return Promise.resolve({ sessionId: "session_1" });
				}
				return Promise.resolve({});
			},
			stop: vi.fn(),
		},
		triggerExit(info: ProcessExitInfo): void {
			for (const handler of exitHandlers) {
				handler(info);
			}
		},
	};
}

describe("opencodeAdapter", () => {
	it("closes `events` once the underlying process exits on its own", async () => {
		const { rpc, triggerExit } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await opencodeAdapter.start("/tmp/project");

		triggerExit({ code: 1, signal: null });

		const result = await handle.events[Symbol.asyncIterator]().next();
		expect(result.done).toBe(true);
	});
});
