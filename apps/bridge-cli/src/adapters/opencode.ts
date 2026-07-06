import {
	normalizeOpencode,
	normalizeOpencodeApprovalRequest,
} from "../normalize/opencode";
import { isRecord, type NormalizedEvent } from "../normalize/types";
import { createApprovalRegistry } from "./approvals";
import { createAsyncQueue } from "./async-queue";
import { connectJsonRpc, type JsonRpcIo } from "./jsonrpc-io";
import { type Adapter, AGENT_EXITED_STATUS, type AgentHandle } from "./types";

/** Reply outcome sent back for a `session/request_permission` request. See
 * the ASSUMPTION note in normalize/opencode.ts about this shape. */
function acpSelectedOutcome(optionId: string): unknown {
	return { outcome: { optionId, outcome: "selected" } };
}

/** Merges the two pieces of context ACP's `available_commands_update`
 * notification doesn't itself carry — the directory this adapter was started
 * in and the session id `session/new` returned — into the `session_ready`
 * event `normalizeOpencode` built from it. */
function enrichOpencodeSessionReady(
	event: Extract<NormalizedEvent, { kind: "status" }>,
	dir: string,
	sessionId: string | undefined
): NormalizedEvent {
	const detail = isRecord(event.detail) ? event.detail : {};
	return {
		kind: "status",
		status: "session_ready",
		detail: { ...detail, cwd: dir, sessionId },
	};
}

/**
 * Wires opencode's ACP `session/update` notification stream to `events`,
 * folding its (at most one, per `normalize/opencode.ts`'s ASSUMPTION note on
 * `normalizeAcpAvailableCommands`) `session_ready` event through
 * `enrichOpencodeSessionReady` and a guard so a hypothetical duplicate
 * `available_commands_update` can never re-emit it. `getSessionId` is read
 * lazily (not captured at registration time) since this handler is wired up
 * before `session/new` resolves with the session id it needs.
 */
function makeOpencodeNotificationHandler(
	dir: string,
	events: { push(event: NormalizedEvent): void },
	getSessionId: () => string | undefined
): (method: string, params: unknown) => void {
	let sessionReadyEmitted = false;
	return (method: string, params: unknown): void => {
		for (const event of normalizeOpencode({ method, params })) {
			if (event.kind === "status" && event.status === "session_ready") {
				if (sessionReadyEmitted) {
					continue;
				}
				sessionReadyEmitted = true;
				events.push(enrichOpencodeSessionReady(event, dir, getSessionId()));
				continue;
			}
			events.push(event);
		}
	};
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
			events.push({ kind: "status", status: AGENT_EXITED_STATUS });
			events.close();
			approvals.clear();
		});

		let sessionId: string | undefined;
		rpc.onNotification(
			makeOpencodeNotificationHandler(dir, events, () => sessionId)
		);
		wireOpencodeApprovals(rpc, events, approvals);

		await rpc.request("initialize", { protocolVersion: 1 });
		const session = await rpc.request("session/new", {
			cwd: dir,
			mcpServers: [],
		});
		sessionId =
			isRecord(session) && typeof session.sessionId === "string"
				? session.sessionId
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
