import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Composer } from "@/components/sessions/composer";
import { MessageBubble } from "@/components/sessions/message-bubble";
import { NewSessionDialog } from "@/components/sessions/new-session-dialog";
import { SessionPicker } from "@/components/sessions/session-picker";
import { useChat } from "@/components/sessions/use-chat";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/sessions")({
	component: SessionsPage,
});

function Conversation({ sessionId }: { sessionId: string }) {
	const { messages, streaming, send, stop } = useChat(sessionId);
	return (
		<Card className="flex h-chat flex-col gap-3 p-4">
			<div className="flex flex-1 flex-col gap-3 overflow-y-auto">
				{messages.length === 0 ? (
					<p className="text-muted-foreground text-sm">No messages yet.</p>
				) : (
					messages.map((message) => (
						<MessageBubble key={message.id} message={message} />
					))
				)}
			</div>
			<Composer
				disabled={false}
				onSend={send}
				onStop={stop}
				streaming={streaming}
			/>
		</Card>
	);
}

function SessionsPage() {
	const sessions = useQuery(orpc.sessions.list.queryOptions());
	const [sessionId, setSessionId] = useState("");
	const [dialogOpen, setDialogOpen] = useState(false);
	return (
		<div className="mx-auto flex max-w-3xl flex-col gap-5">
			<div className="flex flex-col gap-1">
				<h1 className="font-bold text-2xl">Sessions</h1>
				<p className="text-muted-foreground text-sm">
					Chat with a configured agent. Pick a session or start a new one.
				</p>
			</div>
			<div className="flex items-center gap-2">
				<SessionPicker
					onChange={setSessionId}
					sessions={sessions.data ?? []}
					value={sessionId}
				/>
				<Button onClick={() => setDialogOpen(true)} size="sm">
					New session
				</Button>
			</div>
			{sessionId === "" ? (
				<p className="text-muted-foreground text-sm">
					Select or create a session to start chatting.
				</p>
			) : (
				<Conversation key={sessionId} sessionId={sessionId} />
			)}
			{dialogOpen ? (
				<NewSessionDialog
					onCreated={setSessionId}
					onOpenChange={setDialogOpen}
					open={dialogOpen}
				/>
			) : null}
		</div>
	);
}
