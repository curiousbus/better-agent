import { describe, expect, it, vi } from "vitest";
import type { JsonRpcIo } from "./jsonrpc-io";
import { connectJsonRpc } from "./jsonrpc-io";
import { opencodeAdapter } from "./opencode";
import type { ProcessExitInfo } from "./process-io";

vi.mock("./jsonrpc-io", () => ({ connectJsonRpc: vi.fn() }));

type RequestHandler = (id: number, method: string, params: unknown) => void;

/** A fake `JsonRpcIo` whose exit (and server-initiated requests) can be
 * triggered on demand by the test, standing in for the real `opencode acp`
 * process opencode.ts spawns. */
function createFakeRpc(): {
	rpc: JsonRpcIo;
	triggerExit(info: ProcessExitInfo): void;
	triggerRequest(id: number, method: string, params: unknown): void;
} {
	const exitHandlers: Array<(info: ProcessExitInfo) => void> = [];
	const requestHandlers: RequestHandler[] = [];
	return {
		rpc: {
			notify: vi.fn(),
			onExit: (handler) => exitHandlers.push(handler),
			onNotification: vi.fn(),
			onRequest: (handler) => requestHandlers.push(handler),
			respond: vi.fn(),
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
		triggerRequest(id: number, method: string, params: unknown): void {
			for (const handler of requestHandlers) {
				handler(id, method, params);
			}
		},
	};
}

describe("opencodeAdapter", () => {
	it("pushes an agent_exited status, then closes `events`, once the process exits on its own", async () => {
		const { rpc, triggerExit } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await opencodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		triggerExit({ code: 1, signal: null });

		const { value: statusEvent } = await iterator.next();
		expect(statusEvent).toEqual({ kind: "status", status: "agent_exited" });

		const result = await iterator.next();
		expect(result.done).toBe(true);
	});
});

// An arbitrary RPC request id, distinct from 0/1 so it's obviously not being
// confused with an array index or a boolean-ish flag.
const APPROVAL_REQUEST_ID = 3;

describe("opencodeAdapter - approvals", () => {
	it("surfaces a session/request_permission request and replies via answerApproval", async () => {
		const { rpc, triggerRequest } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await opencodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		triggerRequest(APPROVAL_REQUEST_ID, "session/request_permission", {
			sessionId: "session_1",
			toolCall: { title: "Run `ls`", rawInput: { command: "ls" } },
			options: [
				{ optionId: "allow-once", name: "Allow", kind: "allow_once" },
				{ optionId: "reject-once", name: "Deny", kind: "reject_once" },
			],
		});

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			detail: JSON.stringify({ command: "ls" }),
			kind: "approval",
			options: [
				{ id: "allow-once", label: "Allow" },
				{ id: "reject-once", label: "Deny" },
			],
			requestId: String(APPROVAL_REQUEST_ID),
			title: "Run `ls`",
		});

		handle.answerApproval(String(APPROVAL_REQUEST_ID), "allow-once");
		expect(rpc.respond).toHaveBeenCalledExactlyOnceWith(APPROVAL_REQUEST_ID, {
			outcome: { optionId: "allow-once", outcome: "selected" },
		});
	});

	it("emits a status warning instead of replying for an unknown requestId", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);
		const handle = await opencodeAdapter.start("/tmp/project");

		handle.answerApproval("does-not-exist", "allow-once");

		const { value: event } = await handle.events[Symbol.asyncIterator]().next();
		expect(event).toEqual({
			detail: { requestId: "does-not-exist" },
			kind: "status",
			status: "approval_unknown",
		});
		expect(rpc.respond).not.toHaveBeenCalled();
	});
});
