import { useQuery } from "@tanstack/react-query";
import { AGENT_KIND_OPTIONS } from "@/components/bridge/local-agent-kind-icon";
import type { LocalAgentUsageRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import type { WindowDays } from "./dashboard-constants";

function zeroRow(
	agentKind: LocalAgentUsageRow["agentKind"]
): LocalAgentUsageRow {
	return {
		agentKind,
		costUsd: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		turns: 0,
	};
}

/**
 * Local Agent usage broken down by agent kind for the given window. Every
 * agent kind is always returned (zero-filled when it has no usage) so the
 * dashboard shows the full structure; `isEmpty` is true only when NO kind has
 * any usage in the window, which the view turns into a small hint instead.
 */
export function useLocalAgentUsage(windowDays: WindowDays) {
	const query = useQuery(
		orpc.bridge.usageByAgentKind.queryOptions({ input: { windowDays } })
	);
	const byKind = query.data?.byKind ?? [];
	const found = new Map(byKind.map((row) => [row.agentKind, row]));
	const rows = AGENT_KIND_OPTIONS.map(
		(kind) => found.get(kind) ?? zeroRow(kind)
	);
	return {
		isPending: query.isPending,
		isEmpty: !(query.isPending || query.isError) && byKind.length === 0,
		rows,
	};
}
