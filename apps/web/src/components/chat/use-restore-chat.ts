import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { loadLastChat } from "@/components/chat/chat-session";
import type { AgentRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

interface RestoreActions {
	resumeSession: (agent: AgentRow, sessionId: string) => void;
	selectAgent: (agent: AgentRow) => void;
}

// On entering /chat, re-attach instead of starting over: ?agentId targets that
// agent; otherwise the tab's last chat. If the target matches the remembered
// session, RESUME it (a still-streaming turn keeps flowing); only otherwise
// create a fresh session. Runs at most once per mount.
export function useRestoreChat(
	searchAgentId: string | undefined,
	current: AgentRow | null,
	actions: RestoreActions
) {
	const agentsQuery = useQuery(orpc.agents.list.queryOptions());
	const applied = useRef(false);
	useEffect(() => {
		if (current || applied.current) {
			return;
		}
		const stored = loadLastChat();
		const targetId = searchAgentId ?? stored?.agentId;
		if (!targetId) {
			return;
		}
		const found = (agentsQuery.data ?? []).find((a) => a.id === targetId);
		if (!found) {
			return;
		}
		applied.current = true;
		if (stored && stored.agentId === found.id) {
			actions.resumeSession(found, stored.sessionId);
		} else {
			actions.selectAgent(found);
		}
	}, [searchAgentId, current, agentsQuery.data, actions]);
}
