import { describe, expect, it, vi } from "vitest";
import { codexAdapter } from "./codex";
import type { JsonRpcIo } from "./jsonrpc-io";
import { connectJsonRpc } from "./jsonrpc-io";
import type { ProcessExitInfo } from "./process-io";

vi.mock("./jsonrpc-io", () => ({ connectJsonRpc: vi.fn() }));

/** A fake `JsonRpcIo` whose exit can be triggered on demand by the test,
 * standing in for the real `codex app-server` process codex.ts spawns. */
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
				if (method === "thread/start") {
					return Promise.resolve({ thread: { id: "thread_1" } });
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

describe("codexAdapter", () => {
	it("closes `events` once the underlying process exits on its own", async () => {
		const { rpc, triggerExit } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");

		triggerExit({ code: 1, signal: null });

		const result = await handle.events[Symbol.asyncIterator]().next();
		expect(result.done).toBe(true);
	});
});
