import type { AgentClient } from "@better-agent/client";
import { createAgentClient } from "@better-agent/client";
import { env } from "@better-agent/env/web";
import { Button } from "@better-agent/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
	GenerateTokenState,
	RegenerateToken,
} from "@/components/agents/agent-token-controls";
import { TokenRevealDialog } from "@/components/agents/token-reveal-dialog";
import { Conversation } from "@/components/sessions/conversation";
import { SessionPicker } from "@/components/sessions/session-picker";
import type { AgentRow, SessionRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/agents/$agentId")({
	component: AgentDetailPage,
});

// Fetches the agent's token from the server (persisted at create/rotate) and
// builds the token-scoped SDK client from it. No browser cache — so the token
// can't go stale; a null token means the agent has none yet (generate one).
function useAgentClient(agentId: string) {
	const tokenQuery = useQuery(
		orpc.agents.getToken.queryOptions({ input: { id: agentId } })
	);
	const token = tokenQuery.data ?? null;
	const client = useMemo(
		() =>
			token ? createAgentClient({ baseURL: env.VITE_SERVER_URL, token }) : null,
		[token]
	);
	return { client, ready: !tokenQuery.isPending, refetch: tokenQuery.refetch };
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

function EmptySessions({
	agentName,
	onNew,
	pending,
}: {
	agentName: string;
	onNew: () => void;
	pending: boolean;
}) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
			<div>
				<p className="font-medium text-lg">Chat with {agentName}</p>
				<p className="text-muted-foreground text-sm">
					No conversations yet. Start one to begin.
				</p>
			</div>
			<Button className="gap-1" disabled={pending} onClick={onNew}>
				<PlusIcon className="size-4" />
				New session
			</Button>
		</div>
	);
}

function ChatHeader({
	agent,
	sessions,
	sessionId,
	onSessionChange,
	onNewSession,
	newPending,
	onToken,
}: {
	agent: AgentRow;
	sessions: SessionRow[];
	sessionId: string;
	onSessionChange: (id: string) => void;
	onNewSession: () => void;
	newPending: boolean;
	onToken: (token: string) => void;
}) {
	return (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:gap-3 sm:px-4">
			<div className="flex min-w-0 flex-1 items-baseline gap-2">
				<span className="truncate font-medium text-sm">{agent.name}</span>
				<span className="hidden truncate font-mono text-muted-foreground text-xs sm:inline">
					{agent.providerId}/{agent.modelId}
				</span>
			</div>
			<div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
				<SessionPicker
					onChange={onSessionChange}
					sessions={sessions}
					value={sessionId}
				/>
				<Button
					className="gap-1"
					disabled={newPending}
					onClick={onNewSession}
					size="sm"
					variant="outline"
				>
					<PlusIcon className="size-3.5" />
					<span className="hidden sm:inline">New</span>
				</Button>
				<RegenerateToken agentId={agent.id} onToken={onToken} />
			</div>
		</header>
	);
}

// Lists the agent's sessions (newest first), tracks the selected one, and
// auto-selects the latest on load so the chat opens to a conversation.
function useAgentSessions(agentClient: AgentClient, agentId: string) {
	const sessions = useQuery(orpc.sessions.list.queryOptions());
	const agentSessions = useMemo(
		() =>
			(sessions.data ?? [])
				.filter((session) => session.agentId === agentId)
				.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
		[sessions.data, agentId]
	);
	const [sessionId, setSessionId] = useState("");
	const create = useCreateSession(agentClient, setSessionId);
	const latestSessionId = agentSessions[0]?.id;
	useEffect(() => {
		if (sessionId === "" && latestSessionId) {
			setSessionId(latestSessionId);
		}
	}, [sessionId, latestSessionId]);
	return { agentSessions, sessionId, setSessionId, create };
}

function AgentChat({
	agent,
	agentClient,
	onToken,
}: {
	agent: AgentRow;
	agentClient: AgentClient;
	onToken: (token: string) => void;
}) {
	const { agentSessions, sessionId, setSessionId, create } = useAgentSessions(
		agentClient,
		agent.id
	);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ChatHeader
				agent={agent}
				newPending={create.isPending}
				onNewSession={() => create.mutate()}
				onSessionChange={setSessionId}
				onToken={onToken}
				sessionId={sessionId}
				sessions={agentSessions}
			/>
			{sessionId === "" ? (
				<EmptySessions
					agentName={agent.name}
					onNew={() => create.mutate()}
					pending={create.isPending}
				/>
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

function AgentChatPanel({ agent }: { agent: AgentRow }) {
	const { client, ready, refetch } = useAgentClient(agent.id);
	const [revealToken, setRevealToken] = useState<string | null>(null);
	// Rotation persisted the new token server-side; reveal it AND refetch so the
	// client rebuilds with it.
	const onToken = (token: string) => {
		setRevealToken(token);
		refetch();
	};
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{ready && client ? (
				<AgentChat agent={agent} agentClient={client} onToken={onToken} />
			) : null}
			{ready && !client ? (
				<GenerateTokenState agent={agent} onToken={onToken} />
			) : null}
			<TokenRevealDialog
				onClose={() => setRevealToken(null)}
				token={revealToken}
			/>
		</div>
	);
}

function AgentDetailPage() {
	const { agentId } = Route.useParams();
	const agent = useQuery(
		orpc.agents.get.queryOptions({ input: { id: agentId } })
	);
	if (!agent.data) {
		return (
			<div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
				Loading…
			</div>
		);
	}
	return <AgentChatPanel agent={agent.data} key={agentId} />;
}
