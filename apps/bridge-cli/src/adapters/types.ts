import type { NormalizedEvent } from "../normalize";

/** Which local coding agent a bridge session drives. Mirrors `AGENT_KINDS`
 * in `packages/api/src/routers/bridge.ts` — keep the two in sync. */
export type AgentKind = "claude-code" | "opencode" | "codex" | "pi";

/** `status` value pushed on `events` right before it's closed, whenever the
 * underlying process exits on its own — a crash, or the agent simply
 * finishing its work — so the web UI (and CLI stdout) sees an explicit "the
 * process is gone" marker instead of the feed just going quiet. Shared by
 * all three adapters' `onExit`/`rpc.onExit` wiring. */
export const AGENT_EXITED_STATUS = "agent_exited";

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
	/**
	 * Cancels the in-flight turn but keeps the session alive — distinct from
	 * `stop`, which ends the session outright. Optional: only adapters backed
	 * by a control protocol that supports mid-turn cancellation (currently
	 * claude-code, via the SDK's `query.interrupt()`) implement it; the CLI's
	 * `CommandSink` routing (see `apps/bridge-cli/src/commands.ts`) treats a
	 * missing `interrupt` as a no-op rather than an error.
	 */
	interrupt?(): void;
	/**
	 * Fetches the user's past local conversations for this agent (e.g. claude's
	 * `listSessions({dir})`) and pushes them onto `events` as a curated
	 * `session_list` status event. Optional — see `interrupt` for why not every
	 * adapter implements the control methods; only claude-code currently does.
	 */
	listSessions?(): void;
	/** Feeds a user command (from the web UI, relayed through the server) to the agent. */
	send(text: string): void;
	/**
	 * Switches the model used for subsequent turns. Optional — see `interrupt`
	 * for why not every adapter implements the control methods.
	 */
	setModel?(model: string): void;
	/**
	 * Switches the session's permission mode (e.g. "default", "plan",
	 * "acceptEdits"). Optional — see `interrupt` for why not every adapter
	 * implements the control methods.
	 */
	setPermissionMode?(mode: string): void;
	/** Terminates the agent process and releases its resources. */
	stop(): void;
}

/** Options that shape how `Adapter.start` begins a session. */
export interface StartOptions {
	/** A prior conversation id to resume, from `--resume` (see args.ts). Only
	 * claude-code's adapter honors this; every other adapter's `start` simply
	 * doesn't declare the parameter, so it's a no-op for them by construction. */
	resume?: string;
}

/** Spawns and wires up one local coding agent in `dir`. */
export interface Adapter {
	start(dir: string, opts?: StartOptions): Promise<AgentHandle>;
}
