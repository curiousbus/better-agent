import type { AgentClient } from "@better-agent/client";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { AgentGrid } from "@/components/chat/agent-grid";
import { ChatView } from "@/components/chat/chat-view";
import { WebComposer } from "@/components/chat/web-composer";
import { StepTransition } from "@/components/step-transition";
import type { AgentRow, UserSessionRow } from "@/utils/api-types";
import { userAgentClient } from "@/utils/chat-client";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/")({
	component: HomePage,
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

interface SendOpts {
	agentId: string;
	invalidate: () => Promise<void>;
	setInitialText: (text: string) => void;
	setSending: (v: boolean) => void;
	setSessionId: (id: string) => void;
	text: string;
}

// Create a user session then navigate into the chat view, passing the first
// message as initialText so Conversation sends it once it mounts.
async function sendFirstMessage({
	agentId,
	text,
	setSending,
	setSessionId,
	setInitialText,
	invalidate,
}: SendOpts) {
	setSending(true);
	try {
		const session = await client.userSessions.create({ agentId });
		await invalidate();
		setInitialText(text);
		setSessionId(session.id);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to send";
		toast.error(message);
	} finally {
		setSending(false);
	}
}

interface HomeActions {
	clearInitialText: () => void;
	closeChat: () => void;
	closeComposer: () => void;
	newSession: () => void;
	selectAgent: (agent: AgentRow) => void;
	selectSession: (id: string) => void;
	send: (text: string) => Promise<void>;
}

function useHomeActions(
	selectedAgent: AgentRow | null,
	invalidate: () => Promise<void>,
	setInitialText: (t: string) => void,
	setSelectedAgent: (a: AgentRow | null) => void,
	setSessionId: (id: string) => void,
	setSending: (v: boolean) => void
): HomeActions {
	const send = useCallback(
		(text: string) =>
			sendFirstMessage({
				agentId: selectedAgent?.id ?? "",
				text,
				setSending,
				setSessionId,
				setInitialText,
				invalidate,
			}),
		[selectedAgent?.id, invalidate, setSending, setSessionId, setInitialText]
	);
	return {
		clearInitialText: () => setInitialText(""),
		closeChat: () => {
			setInitialText("");
			setSessionId("");
		},
		closeComposer: () => {
			setSelectedAgent(null);
			setSessionId("");
		},
		newSession: () => {
			setInitialText("");
			setSessionId("");
		},
		selectAgent: (agent: AgentRow) => {
			setSelectedAgent(agent);
			setSessionId("");
		},
		selectSession: setSessionId,
		send,
	};
}

function useHomeState() {
	const [selectedAgent, setSelectedAgent] = useState<AgentRow | null>(null);
	const [sessionId, setSessionId] = useState("");
	const [initialText, setInitialText] = useState("");
	const [sending, setSending] = useState(false);
	const queryClient = useQueryClient();
	const agentClient = useUserAgentClient(selectedAgent?.id ?? null);
	const sessions = useUserSessions(selectedAgent?.id ?? null);
	const invalidate = useCallback(
		() =>
			queryClient.invalidateQueries({
				queryKey: orpc.userSessions.list.key(),
			}),
		[queryClient]
	);
	const actions = useHomeActions(
		selectedAgent,
		invalidate,
		setInitialText,
		setSelectedAgent,
		setSessionId,
		setSending
	);
	return {
		selectedAgent,
		sessionId,
		initialText,
		sending,
		agentClient,
		sessions,
		...actions,
	};
}

interface ChatPanelProps {
	agent: AgentRow;
	agentClient: AgentClient | null;
	initialText: string;
	onClearInitialText: () => void;
	onClose: () => void;
	onNewSession: () => void;
	onSessionChange: (id: string) => void;
	sessionId: string;
	sessions: UserSessionRow[];
}

function ChatPanel({
	agent,
	agentClient,
	initialText,
	onClearInitialText,
	onClose,
	onNewSession,
	onSessionChange,
	sessionId,
	sessions,
}: ChatPanelProps) {
	if (!agentClient) {
		return null;
	}
	// Clear initialText once Conversation has consumed it so a future remount
	// (e.g. navigating chat→composer→chat) never re-sends a stale value.
	const handleSessionChange = (id: string) => {
		onClearInitialText();
		onSessionChange(id);
	};
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ChatView
				agent={agent}
				agentClient={agentClient}
				initialText={initialText}
				onClose={onClose}
				onNewSession={onNewSession}
				onSessionChange={handleSessionChange}
				sessionId={sessionId}
				sessions={sessions}
			/>
		</div>
	);
}

const STEP_GRID = 0;
const STEP_COMPOSER = 1;
const STEP_CHAT = 2;

function HomeContent({ home }: { home: ReturnType<typeof useHomeState> }) {
	const { selectedAgent, sessionId } = home;
	if (!selectedAgent) {
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<AgentGridView onSelect={home.selectAgent} />
			</div>
		);
	}
	if (sessionId === "") {
		return (
			<WebComposer
				agent={selectedAgent}
				onClose={home.closeComposer}
				onSend={home.send}
				onSessionSelect={home.selectSession}
				sending={home.sending}
				sessions={home.sessions}
			/>
		);
	}
	return (
		<ChatPanel
			agent={selectedAgent}
			agentClient={home.agentClient}
			initialText={home.initialText}
			onClearInitialText={home.clearInitialText}
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
	let step = STEP_GRID;
	if (home.selectedAgent) {
		step = home.sessionId === "" ? STEP_COMPOSER : STEP_CHAT;
	}
	return (
		<StepTransition step={step}>
			<HomeContent home={home} />
		</StepTransition>
	);
}
