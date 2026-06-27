import { Button } from "@better-agent/ui/components/button";
import { Conversation } from "@better-agent/ui/components/chat/conversation";
import { SessionPicker } from "@better-agent/ui/components/chat/session-picker";
import type { AgentClient } from "@curiousbus/agent-client";
import { PlusIcon, XIcon } from "lucide-react";
import type { AgentRow, UserSessionRow } from "@/utils/api-types";

interface ChatViewProps {
	agent: AgentRow;
	agentClient: AgentClient;
	initialText?: string;
	onClose: () => void;
	onNewSession: () => void;
	onSessionChange: (sessionId: string) => void;
	sessionId: string;
	sessions: UserSessionRow[];
}

function ChatViewHeader({
	agent,
	sessionId,
	sessions,
	onClose,
	onSessionChange,
	onNewSession,
}: Omit<ChatViewProps, "agentClient" | "initialText">) {
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
					onClick={onNewSession}
					size="sm"
					variant="outline"
				>
					<PlusIcon className="size-3.5" />
					<span className="hidden sm:inline">New</span>
				</Button>
				<button
					aria-label="Back to composer"
					className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={onClose}
					type="button"
				>
					<XIcon className="size-4" />
				</button>
			</div>
		</header>
	);
}

export function ChatView({
	agent,
	agentClient,
	initialText,
	sessionId,
	sessions,
	onClose,
	onSessionChange,
	onNewSession,
}: ChatViewProps) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ChatViewHeader
				agent={agent}
				onClose={onClose}
				onNewSession={onNewSession}
				onSessionChange={onSessionChange}
				sessionId={sessionId}
				sessions={sessions}
			/>
			<Conversation
				agentClient={agentClient}
				initialText={initialText}
				key={sessionId}
				sessionId={sessionId}
			/>
		</div>
	);
}
