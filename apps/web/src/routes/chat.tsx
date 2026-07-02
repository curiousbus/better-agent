import { Skeleton } from "@better-agent/ui/components/skeleton";
import type { AgentClient } from "@curiousbus/agent-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { AgentGrid } from "@/components/chat/agent-grid";
import { ChatView } from "@/components/chat/chat-view";
import { usePreselectAgent } from "@/components/chat/use-preselect-agent";
import { StepTransition } from "@/components/step-transition";
import type { AgentRow, UserSessionRow } from "@/utils/api-types";
import { userAgentClient } from "@/utils/chat-client";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/chat")({
	component: HomePage,
	validateSearch: (search: Record<string, unknown>): { agentId?: string } => ({
		agentId: typeof search.agentId === "string" ? search.agentId : undefined,
	}),
});

function useUserAgentClient(agentId: string | null): AgentClient | null {
	return useMemo(() => (agentId ? userAgentClient(agentId) : null), [agentId]);
}

function useUserSessions(agentId: string | null): UserSessionRow[] {
	const query = useQuery(orpc.userSessions.list.queryOptions());
	return useMemo(
		() =>
			agentId ? (query.data ?? []).filter((s) => s.agentId === agentId) : [],
		[query.data, agentId]
	);
}

const SKELETON_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6"];

function AgentGridSkeleton() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{SKELETON_KEYS.map((key) => (
					<Skeleton className="h-24" key={key} />
				))}
			</div>
		</div>
	);
}

function AgentGridView({ onSelect }: { onSelect: (agent: AgentRow) => void }) {
	const agentsQuery = useQuery(orpc.agents.list.queryOptions());
	const agents = agentsQuery.data ?? [];
	if (agentsQuery.isPending) {
		return <AgentGridSkeleton />;
	}
	return (
		<div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
			<AgentGrid agents={agents} onSelect={onSelect} />
		</div>
	);
}

interface CreateSessionOpts {
	agentId: string;
	invalidate: () => Promise<void>;
	setSending: (v: boolean) => void;
	setSessionId: (id: string) => void;
}

async function createSession({
	agentId,
	invalidate,
	setSending,
	setSessionId,
}: CreateSessionOpts): Promise<void> {
	setSending(true);
	try {
		const session = await client.userSessions.create({ agentId });
		await invalidate();
		setSessionId(session.id);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to create session";
		toast.error(message);
	} finally {
		setSending(false);
	}
}

interface HomeActions {
	closeChat: () => void;
	newSession: () => void;
	selectAgent: (agent: AgentRow) => void;
	selectSession: (id: string) => void;
}

function useHomeActions(
	invalidate: () => Promise<void>,
	setSelectedAgent: (a: AgentRow | null) => void,
	setSessionId: (id: string) => void,
	setSending: (v: boolean) => void
): HomeActions {
	return {
		closeChat: () => {
			setSelectedAgent(null);
			setSessionId("");
		},
		newSession: () => {
			setSessionId("");
		},
		selectAgent: (agent: AgentRow) => {
			setSelectedAgent(agent);
			setSessionId("");
			createSession({
				agentId: agent.id,
				invalidate,
				setSending,
				setSessionId,
			}).catch(() => undefined);
		},
		selectSession: setSessionId,
	};
}

function useHomeState() {
	const [selectedAgent, setSelectedAgent] = useState<AgentRow | null>(null);
	const [sessionId, setSessionId] = useState("");
	const [sending, setSending] = useState(false);
	const [genuiOn, setGenuiOn] = useState(false);
	const queryClient = useQueryClient();
	const agentClient = useUserAgentClient(selectedAgent?.id ?? null);
	const sessions = useUserSessions(selectedAgent?.id ?? null);
	usePreselectAgent(Route.useSearch().agentId, selectedAgent, setSelectedAgent);
	const invalidate = useCallback(
		() =>
			queryClient.invalidateQueries({
				queryKey: orpc.userSessions.list.key(),
			}),
		[queryClient]
	);
	const actions = useHomeActions(
		invalidate,
		setSelectedAgent,
		setSessionId,
		setSending
	);
	return {
		selectedAgent,
		sessionId,
		sending,
		genuiOn,
		toggleGenui: () => setGenuiOn((v) => !v),
		agentClient,
		sessions,
		...actions,
	};
}

interface ChatPanelProps {
	agent: AgentRow;
	agentClient: AgentClient | null;
	initialGenui: boolean;
	onClose: () => void;
	onNewSession: () => void;
	onSessionChange: (id: string) => void;
	sessionId: string;
	sessions: UserSessionRow[];
}

function ChatPanel({
	agent,
	agentClient,
	initialGenui,
	onClose,
	onNewSession,
	onSessionChange,
	sessionId,
	sessions,
}: ChatPanelProps) {
	if (!agentClient) {
		return null;
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ChatView
				agent={agent}
				agentClient={agentClient}
				initialGenui={initialGenui}
				onClose={onClose}
				onNewSession={onNewSession}
				onSessionChange={onSessionChange}
				sessionId={sessionId}
				sessions={sessions}
			/>
		</div>
	);
}

const STEP_GRID = 0;
const STEP_CHAT = 1;

function HomeContent({ home }: { home: ReturnType<typeof useHomeState> }) {
	const { selectedAgent, sessionId, sending } = home;
	if (!selectedAgent) {
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<AgentGridView onSelect={home.selectAgent} />
			</div>
		);
	}
	if (sending || sessionId === "") {
		return <AgentGridSkeleton />;
	}
	return (
		<ChatPanel
			agent={selectedAgent}
			agentClient={home.agentClient}
			initialGenui={home.genuiOn}
			onClose={home.closeChat}
			onNewSession={home.newSession}
			onSessionChange={home.selectSession}
			sessionId={sessionId}
			sessions={home.sessions}
		/>
	);
}

function HomePage() {
	const home = useHomeState();
	const step =
		home.selectedAgent && home.sessionId !== "" ? STEP_CHAT : STEP_GRID;
	return (
		<StepTransition step={step}>
			<HomeContent home={home} />
		</StepTransition>
	);
}
