import { Button } from "@better-agent/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@better-agent/ui/components/card";
import type { GenerativeUIChatConfig } from "@better-agent/ui/components/chat/conversation";
import { Conversation } from "@better-agent/ui/components/chat/conversation";
import type { AgentClient } from "@curiousbus/agent-client";
import { MessageCircle, X } from "lucide-react";
import { useState } from "react";

interface BoardChatProps {
	agentClient: AgentClient;
	generativeUI: GenerativeUIChatConfig;
	sessionId: string;
}

function ChatPanel({ agentClient, sessionId, generativeUI }: BoardChatProps) {
	return (
		<Card
			className={[
				"fixed right-6 bottom-24 z-50",
				"w-[24rem] max-w-[calc(100vw-3rem)]",
				"h-[600px] max-h-[70vh]",
				"flex flex-col",
				"fade-in slide-in-from-bottom-2 animate-in",
				"motion-reduce:animate-none",
				"shadow-xl",
			].join(" ")}
		>
			<CardHeader className="border-b py-3">
				<CardTitle>Assistant</CardTitle>
			</CardHeader>
			<CardContent className="flex min-h-0 flex-1 flex-col p-0">
				<Conversation
					agentClient={agentClient}
					generativeUI={generativeUI}
					sessionId={sessionId}
				/>
			</CardContent>
		</Card>
	);
}

export function BoardChat({
	agentClient,
	sessionId,
	generativeUI,
}: BoardChatProps) {
	const [open, setOpen] = useState(false);

	return (
		<>
			{open && (
				<ChatPanel
					agentClient={agentClient}
					generativeUI={generativeUI}
					sessionId={sessionId}
				/>
			)}
			<Button
				aria-label={open ? "Close assistant" : "Open assistant"}
				className="fixed right-6 bottom-6 z-50 size-12 rounded-full shadow-lg"
				onClick={() => setOpen((v) => !v)}
				size="icon"
				variant="default"
			>
				{open ? <X /> : <MessageCircle />}
			</Button>
		</>
	);
}
