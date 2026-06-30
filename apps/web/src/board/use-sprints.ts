import type { AgentClient } from "@curiousbus/agent-client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export interface BoardSprint {
	endDate?: string;
	goal?: string;
	id: string;
	name: string;
	startDate?: string;
	status: string;
}

function parseSprint(raw: unknown): BoardSprint | null {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const r = raw as Record<string, unknown>;
	if (typeof r.id !== "string" || typeof r.name !== "string") {
		return null;
	}
	return {
		id: r.id,
		name: r.name,
		goal: typeof r.goal === "string" ? r.goal : undefined,
		status: typeof r.status === "string" ? r.status : "unknown",
		startDate: typeof r.startDate === "string" ? r.startDate : undefined,
		endDate: typeof r.endDate === "string" ? r.endDate : undefined,
	};
}

function parseSprints(raw: unknown): BoardSprint[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.flatMap((item) => {
		const s = parseSprint(item);
		return s ? [s] : [];
	});
}

function useSprintLoader(agentClient: AgentClient | null, sessionId: string) {
	const [active, setActive] = useState<BoardSprint | null>(null);
	const [sprints, setSprints] = useState<BoardSprint[]>([]);
	const [loading, setLoading] = useState(false);

	const refresh = useCallback(() => {
		if (!(agentClient && sessionId)) {
			return;
		}
		setLoading(true);
		Promise.all([
			agentClient.runTool(sessionId, "activeSprint", {}),
			agentClient.runTool(sessionId, "listSprints", {}),
		])
			.then(([a, l]) => {
				setActive(parseSprint(a));
				setSprints(parseSprints(l));
			})
			.catch(() => toast.error("Failed to load sprints."))
			.finally(() => setLoading(false));
	}, [agentClient, sessionId]);

	useEffect(() => {
		if (sessionId) {
			refresh();
		}
	}, [sessionId, refresh]);

	return { active, sprints, loading, refresh };
}

function useSprintMutations(
	agentClient: AgentClient | null,
	sessionId: string,
	refresh: () => void
) {
	const run = useCallback(
		async (tool: string, args: Record<string, unknown>, msg: string) => {
			if (!agentClient) {
				return;
			}
			try {
				await agentClient.runTool(sessionId, tool, args);
				refresh();
			} catch {
				toast.error(msg);
			}
		},
		[agentClient, sessionId, refresh]
	);

	const createSprint = useCallback(
		(name: string, goal?: string) =>
			run("createSprint", { name, goal }, "Failed to create sprint."),
		[run]
	);
	const startSprint = useCallback(
		(id: string) => run("startSprint", { id }, "Failed to start sprint."),
		[run]
	);
	const completeSprint = useCallback(
		(id: string) => run("completeSprint", { id }, "Failed to complete sprint."),
		[run]
	);

	return { createSprint, startSprint, completeSprint };
}

export function useSprints(agentClient: AgentClient | null, sessionId: string) {
	const { active, sprints, loading, refresh } = useSprintLoader(
		agentClient,
		sessionId
	);
	const { createSprint, startSprint, completeSprint } = useSprintMutations(
		agentClient,
		sessionId,
		refresh
	);
	return {
		active,
		sprints,
		loading,
		refresh,
		createSprint,
		startSprint,
		completeSprint,
	};
}
