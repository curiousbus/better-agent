import {
	normalizeOpencode,
	normalizeOpencodeApprovalRequest,
} from "../normalize/opencode";
import type { NormalizedEvent } from "../normalize/types";
import { createApprovalRegistry } from "./approvals";
import { createAsyncQueue } from "./async-queue";
import { connectJsonRpc, type JsonRpcIo } from "./jsonrpc-io";
import type { Adapter, AgentHandle } from "./types";

/** Reply outcome sent back for a `session/request_permission` request. See
 * the ASSUMPTION note in normalize/opencode.ts about this shape. */
function acpSelectedOutcome(optionId: string): unknown {
	return { outcome: { optionId, outcome: "selected" } };
}

/** Wires opencode's ACP `session/request_permission` requests to the shared
 * approval registry: registers a reply function that answers the RPC
 * request, and emits the normalized event. */
function wireOpencodeApprovals(
	rpc: JsonRpcIo,
	events: { push(event: NormalizedEvent): void },
	approvals: ReturnType<typeof createApprovalRegistry>
): void {
	rpc.onRequest((id, method, params) => {
		const requestId = String(id);
		const approvalEvents = normalizeOpencodeApprovalRequest(
			requestId,
			method,
			params
		);
		const [approvalEvent] = approvalEvents;
		if (!approvalEvent) {
			return;
		}
		approvals.register(requestId, approvalEvent.options, (optionId) => {
			rpc.respond(id, acpSelectedOutcome(optionId));
		});
		for (const event of approvalEvents) {
			events.push(event);
		}
	});
}

/** `opencode acp` — the Agent Client Protocol server built into opencode. */
export const opencodeAdapter: Adapter = {
	async start(dir: string): Promise<AgentHandle> {
		const rpc = await connectJsonRpc("opencode", ["acp"], dir);
		const events = createAsyncQueue<NormalizedEvent>();
		const approvals = createApprovalRegistry(events);
		rpc.onExit(() => {
			events.close();
			approvals.clear();
		});

		rpc.onNotification((method, params) => {
			for (const event of normalizeOpencode({ method, params })) {
				events.push(event);
			}
		});
		wireOpencodeApprovals(rpc, events, approvals);

		await rpc.request("initialize", { protocolVersion: 1 });
		const session = await rpc.request("session/new", {
			cwd: dir,
			mcpServers: [],
		});
		const sessionId =
			session !== null && typeof session === "object" && "sessionId" in session
				? (session as { sessionId: unknown }).sessionId
				: undefined;

		return {
			answerApproval(requestId: string, optionId: string): void {
				approvals.answer(requestId, optionId);
			},
			events,
			send(text: string): void {
				rpc
					.request("session/prompt", {
						sessionId,
						prompt: [{ type: "text", text }],
					})
					.catch((error: unknown) => {
						events.push({
							kind: "error",
							message: "opencode session/prompt failed",
							detail: error,
						});
					});
			},
			stop(): void {
				rpc.stop();
				events.close();
				approvals.clear();
			},
		};
	},
};
