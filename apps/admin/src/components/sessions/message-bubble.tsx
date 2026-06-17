import { Badge } from "@better-agent/ui/components/badge";
import { Card } from "@better-agent/ui/components/card";
import { cn } from "@better-agent/ui/lib/utils";

import type { ChatMessage } from "./use-chat";

export function MessageBubble({ message }: { message: ChatMessage }) {
	const isUser = message.role === "user";
	const streamingEmpty = message.status === "streaming" && message.text === "";
	return (
		<div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
			<Card
				className={cn(
					"max-w-[80%] gap-2 p-3",
					isUser ? "bg-primary text-primary-foreground" : "bg-card"
				)}
			>
				{message.reasoning === "" ? null : (
					<p className="whitespace-pre-wrap text-muted-foreground text-xs italic">
						{message.reasoning}
					</p>
				)}
				<p className="whitespace-pre-wrap text-sm">
					{streamingEmpty ? "…" : message.text}
				</p>
				{message.status === "error" ? (
					<Badge variant="destructive">error</Badge>
				) : null}
			</Card>
		</div>
	);
}
