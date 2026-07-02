import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { AgentRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

// Arriving via /chat?agentId=… (an agent row's chat action): once agents load,
// run the SAME select action a manual click uses — it creates the session, and
// the page flips to the live chat. Runs at most once per mount.
export function usePreselectAgent(
	searchAgentId: string | undefined,
	current: AgentRow | null,
	selectAgent: (agent: AgentRow) => void
) {
	const agentsQuery = useQuery(orpc.agents.list.queryOptions());
	const applied = useRef(false);
	useEffect(() => {
		if (!searchAgentId || current || applied.current) {
			return;
		}
		const found = (agentsQuery.data ?? []).find((a) => a.id === searchAgentId);
		if (found) {
			applied.current = true;
			selectAgent(found);
		}
	}, [searchAgentId, current, agentsQuery.data, selectAgent]);
}
