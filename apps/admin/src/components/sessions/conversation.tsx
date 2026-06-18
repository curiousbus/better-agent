import { Card } from "@better-agent/ui/components/card";

import { Composer } from "./composer";
import { MessageBubble } from "./message-bubble";
import { useChat } from "./use-chat";

export function Conversation({ sessionId }: { sessionId: string }) {
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
