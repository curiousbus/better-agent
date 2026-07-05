// A pending-approval registry shared by all three adapters: each keeps a
// requestId -> protocol-specific reply function, so `AgentHandle.answerApproval`
// has one uniform way to look a request up and invoke its reply, regardless
// of which wire protocol (codex JSON-RPC, opencode ACP, claude-code
// control_request) produced it. Cleared on process exit so a dead agent
// never leaves a dangling reply function that would write to a closed pipe.

import type { NormalizedEvent } from "../normalize/types";

/** Status emitted in place of a reply when `answer()` is called with a
 * `requestId` that was never registered, or was already answered. */
const APPROVAL_UNKNOWN_STATUS = "approval_unknown";

export interface ApprovalRegistry {
	/**
	 * Looks up `requestId` and invokes its reply function with `optionId`,
	 * removing it from the registry so a duplicate `answer()` call for the
	 * same id is a no-op. An unknown id (never registered, already answered,
	 * or dropped by `clear()`) emits a `status` warning event instead of
	 * throwing, since the agent may simply have moved on by the time the
	 * user answers.
	 */
	answer(requestId: string, optionId: string): void;
	/** Drops every still-pending reply function. Call once the agent process
	 * has exited, so a later `answer()` for a stale id can never write to a
	 * closed pipe. */
	clear(): void;
	/** Registers `reply` to be invoked (at most once) by a matching `answer()`. */
	register(requestId: string, reply: (optionId: string) => void): void;
}

/** Builds an `ApprovalRegistry` that reports unknown-id answers on `events`. */
export function createApprovalRegistry(events: {
	push(event: NormalizedEvent): void;
}): ApprovalRegistry {
	const pending = new Map<string, (optionId: string) => void>();
	return {
		register(requestId, reply) {
			pending.set(requestId, reply);
		},
		answer(requestId, optionId) {
			const reply = pending.get(requestId);
			if (!reply) {
				events.push({
					kind: "status",
					status: APPROVAL_UNKNOWN_STATUS,
					detail: { requestId },
				});
				return;
			}
			pending.delete(requestId);
			reply(optionId);
		},
		clear() {
			pending.clear();
		},
	};
}
