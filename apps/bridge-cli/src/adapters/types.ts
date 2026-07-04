import type { NormalizedEvent } from "../normalize";

/** Which local coding agent a bridge session drives. Mirrors `AGENT_KINDS`
 * in `packages/api/src/routers/bridge.ts` — keep the two in sync. */
export type AgentKind = "claude-code" | "opencode" | "codex";

/** A running agent process, already normalizing its own output. */
export interface AgentHandle {
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
