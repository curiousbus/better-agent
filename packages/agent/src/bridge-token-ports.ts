// Bridge-token port types, split out of ports.ts so that file stays under the
// repo's 300-line limit. Self-contained (no imports back into ports.ts) to
// avoid a circular type-only dependency; ports.ts re-exports these.

/** Which local coding agent a bridge session drives. */
export type BridgeAgentKind = "claude-code" | "opencode" | "codex" | "pi";

/** Persisted startup config for a local-agent bridge token (Phase 4):
 * `appendSystemPrompt` (claude SDK; other adapters best-effort) and `maxTurns`.
 * Richer per-agent options (tools, mcp, …) extend this same shape. Live
 * controls (model, permission/mode) stay in the composer, not here. */
export interface BridgeTokenConfig {
	appendSystemPrompt?: string;
	maxTurns?: number;
}

/** Owner-facing bridge token: raw `token` + bound `agentKind`, never the hash. */
export interface BridgeTokenRow {
	agentKind: BridgeAgentKind;
	/** Persisted startup config (Phase 4); null on legacy rows predating it. */
	config: BridgeTokenConfig | null;
	createdAt: Date;
	id: string;
	last4: string | null;
	name: string | null;
	revokedAt: Date | null;
	token: string | null;
	userId: string;
}

export interface BridgeTokenStore {
	create(input: {
		userId: string;
		name?: string;
		agentKind: BridgeAgentKind;
		token: string;
		tokenHash: string;
		last4?: string;
		config?: BridgeTokenConfig;
	}): Promise<BridgeTokenRow>;
	deleteAgent(id: string, userId: string): Promise<void>;
	/** Looked up on every bridge request; null when the hash is unknown. */
	findByHash(
		tokenHash: string
	): Promise<{ id: string; userId: string; revokedAt: Date | null } | null>;
	getById(id: string, userId: string): Promise<BridgeTokenRow | null>;
	listByUser(userId: string): Promise<BridgeTokenRow[]>;
	/** Replaces the token's persisted startup config (Phase 4). */
	updateConfig(
		id: string,
		userId: string,
		config: BridgeTokenConfig
	): Promise<BridgeTokenRow | null>;
}
