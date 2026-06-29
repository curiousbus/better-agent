import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { GenerativeUIView } from "@/components/genui/genui-view";
import { userAgentClient } from "@/utils/chat-client";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/genui")({
	component: GenUiPage,
});

function GenUiPage() {
	const agentsQuery = useQuery(orpc.agents.list.queryOptions());
	const agent = agentsQuery.data?.[0] ?? null;
	const agentClient = useMemo(
		() => (agent ? userAgentClient(agent.id) : null),
		[agent]
	);
	if (agentsQuery.isPending) {
		return <Skeleton className="m-4 h-24" />;
	}
	if (!agentClient) {
		return <p className="p-4 text-sm">No agent available. Create one first.</p>;
	}
	return <GenerativeUIView agentClient={agentClient} />;
}
