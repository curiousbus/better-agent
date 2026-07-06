import type { BridgeAgentKind } from "../ports";

/** One agent kind's summed `turn_usage` totals over a rolling window — the
 * Local Agents dashboard breakdown. Costs/tokens come from the persisted
 * `turn_usage` status events (see `apps/bridge-cli`'s normalize layer). */
export interface BridgeAgentKindUsage {
	agentKind: BridgeAgentKind;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
	turns: number;
}

export interface BridgeUsageStore {
	/** Per-agent-kind `turn_usage` totals for one owner since `since`. Only
	 * kinds with at least one turn_usage event in the window appear. */
	usageByAgentKind(
		userId: string,
		since: Date
	): Promise<BridgeAgentKindUsage[]>;
}
