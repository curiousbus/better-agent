import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Conversation } from "@/components/sessions/conversation";
import { SessionPicker } from "@/components/sessions/session-picker";
import type { AgentRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/agents/$agentId")({
	component: AgentDetailPage,
});

function AgentSummary({ agent }: { agent: AgentRow }) {
	return (
		<Card className="flex flex-col gap-2 p-4">
			<div className="font-mono text-muted-foreground text-sm">
				{agent.providerId}/{agent.modelId}
			</div>
			<p className="text-sm">{agent.description}</p>
			<p className="whitespace-pre-wrap text-muted-foreground text-xs">
				{agent.systemPrompt}
			</p>
		</Card>
	);
}

function AgentSessions({ agentId }: { agentId: string }) {
	const queryClient = useQueryClient();
	const sessions = useQuery(orpc.sessions.list.queryOptions());
	const agentSessions = (sessions.data ?? []).filter(
		(session) => session.agentId === agentId
	);
	const [sessionId, setSessionId] = useState("");
	const create = useMutation(
		orpc.sessions.create.mutationOptions({
			onSuccess: (session) => {
				queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() });
				setSessionId(session.id);
			},
			onError: (error) => toast.error(error.message),
		})
	);
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<SessionPicker
					onChange={setSessionId}
					sessions={agentSessions}
					value={sessionId}
				/>
				<Button
					disabled={create.isPending}
					onClick={() => create.mutate({ agentId })}
					size="sm"
				>
					New session
				</Button>
			</div>
			{sessionId === "" ? (
				<p className="text-muted-foreground text-sm">
					Select or start a session to chat with this agent.
				</p>
			) : (
				<Conversation key={sessionId} sessionId={sessionId} />
			)}
		</div>
	);
}

function AgentDetailPage() {
	const { agentId } = Route.useParams();
	const agent = useQuery(
		orpc.agents.get.queryOptions({ input: { id: agentId } })
	);
	return (
		<div className="mx-auto flex max-w-3xl flex-col gap-5">
			<div className="flex flex-col gap-1">
				<Link
					className="text-muted-foreground text-sm hover:underline"
					to="/agents"
				>
					← Agents
				</Link>
				<h1 className="font-bold text-2xl">{agent.data?.name ?? "Agent"}</h1>
			</div>
			{agent.data ? <AgentSummary agent={agent.data} /> : null}
			<AgentSessions agentId={agentId} />
		</div>
	);
}
