import type { NormalizedEvent } from "../normalize";

/** Which local coding agent a bridge session drives. Mirrors `AGENT_KINDS`
 * in `packages/api/src/routers/bridge.ts` — keep the two in sync. */
export type AgentKind = "claude-code" | "opencode" | "codex";

/** A running agent process, already normalizing its own output. */
export interface AgentHandle {
	/**
	 * Answers a pending `ApprovalEvent` (previously emitted on `events`) with
	 * the id of the option the user picked, and sends the corresponding reply
	 * on the agent's underlying protocol. A `requestId` that's unknown or
	 * already answered is a no-op that instead emits a `status` warning event
	 * — the request may have already been resolved (e.g. the agent moved on)
	 * by the time the user answers.
	 */
	answerApproval(requestId: string, optionId: string): void;
	/** Normalized events, in emission order. Completes when the agent exits. */
	events: AsyncIterable<NormalizedEvent>;
	/** Feeds a user command (from the web UI, relayed through the server) to the agent. */
	send(text: string): void;
	/** Terminates the agent process and releases its resources. */
	stop(): void;
}

/** Spawns and wires up one local coding agent in `dir`. */
export interface Adapter {
	start(dir: string): Promise<AgentHandle>;
}
