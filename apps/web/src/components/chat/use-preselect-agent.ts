import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import type { AgentRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

// Preselect the agent when arriving via /chat?agentId=… (from an agent's row).
export function usePreselectAgent(
	searchAgentId: string | undefined,
	current: AgentRow | null,
	setSelectedAgent: (agent: AgentRow) => void
) {
	const agentsQuery = useQuery(orpc.agents.list.queryOptions());
	useEffect(() => {
		if (!searchAgentId || current) {
			return;
		}
		const found = (agentsQuery.data ?? []).find((a) => a.id === searchAgentId);
		if (found) {
			setSelectedAgent(found);
		}
	}, [searchAgentId, current, agentsQuery.data, setSelectedAgent]);
}
