import type { AgentClient } from "@better-agent/client";
import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Conversation } from "@/components/sessions/conversation";
import { SessionPicker } from "@/components/sessions/session-picker";
import { getAgentClient } from "@/utils/agent-client";
import { saveAgentToken } from "@/utils/agent-token";
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

// Builds the token-scoped SDK client from the cached token. `ready` stays false
// until after mount so SSR/first render don't flash the "generate token" state
// (localStorage is browser-only), avoiding a hydration mismatch.
function useAgentClient(agentId: string) {
	const [client, setClient] = useState<AgentClient | null>(null);
	const [ready, setReady] = useState(false);
	const refresh = useCallback(() => {
		setClient(getAgentClient(agentId));
		setReady(true);
	}, [agentId]);
	useEffect(() => {
		refresh();
	}, [refresh]);
	return { client, ready, refresh };
}

function useRotateToken(onRotated: () => void) {
	return useMutation(
		orpc.agents.rotateToken.mutationOptions({
			onSuccess: (result) => {
				saveAgentToken(result.agent.id, result.token);
				toast.success("Token generated — copy it now (shown once)", {
					description: result.token,
					duration: 30_000,
				});
				onRotated();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function GenerateTokenCard({
	agentId,
	onRefresh,
}: {
	agentId: string;
	onRefresh: () => void;
}) {
	const rotate = useRotateToken(onRefresh);
	return (
		<Card className="flex flex-col items-start gap-3 p-4">
			<p className="text-muted-foreground text-sm">
				This agent has no token cached in this browser. Generate one to chat —
				the token is shown once and stored locally.
			</p>
			<Button
				disabled={rotate.isPending}
				onClick={() => rotate.mutate({ id: agentId })}
				size="sm"
			>
				Generate token
			</Button>
		</Card>
	);
}

function RegenerateToken({
	agentId,
	onRefresh,
}: {
	agentId: string;
	onRefresh: () => void;
}) {
	const rotate = useRotateToken(onRefresh);
	const [open, setOpen] = useState(false);
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger render={<Button size="xs" variant="outline" />}>
				Regenerate token
			</PopoverTrigger>
			<PopoverContent>
				<PopoverTitle className="text-sm">
					Regenerate token? Any external client using the old token will stop
					working.
				</PopoverTitle>
				<div className="mt-2 flex justify-end gap-2">
					<Button onClick={() => setOpen(false)} size="xs" variant="outline">
						Cancel
					</Button>
					<Button
						disabled={rotate.isPending}
						onClick={() => {
							setOpen(false);
							rotate.mutate({ id: agentId });
						}}
						size="xs"
					>
						Confirm
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function useCreateSession(
	agentClient: AgentClient,
	onCreated: (sessionId: string) => void
) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => agentClient.createSession(),
		onSuccess: ({ sessionId }) => {
			queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() });
			onCreated(sessionId);
		},
		onError: (error: Error) => toast.error(error.message),
	});
}

function AgentSessions({
	agentId,
	agentClient,
}: {
	agentId: string;
	agentClient: AgentClient;
}) {
	const sessions = useQuery(orpc.sessions.list.queryOptions());
	const agentSessions = (sessions.data ?? []).filter(
		(session) => session.agentId === agentId
	);
	const [sessionId, setSessionId] = useState("");
	const create = useCreateSession(agentClient, setSessionId);
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
					onClick={() => create.mutate()}
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
				<Conversation
					agentClient={agentClient}
					key={sessionId}
					sessionId={sessionId}
				/>
			)}
		</div>
	);
}

function AgentChatPanel({ agentId }: { agentId: string }) {
	const { client, ready, refresh } = useAgentClient(agentId);
	if (!ready) {
		return null;
	}
	if (!client) {
		return <GenerateTokenCard agentId={agentId} onRefresh={refresh} />;
	}
	return (
		<div className="flex flex-col gap-3">
			<div className="flex justify-end">
				<RegenerateToken agentId={agentId} onRefresh={refresh} />
			</div>
			<AgentSessions agentClient={client} agentId={agentId} />
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
			<AgentChatPanel agentId={agentId} />
		</div>
	);
}
