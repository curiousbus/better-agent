import { CopyAction } from "@better-agent/ui/components/actions";
import { Badge } from "@better-agent/ui/components/badge";
import { Card } from "@better-agent/ui/components/card";
import {
	ConversationContent,
	Conversation as ConversationRoot,
	ConversationScrollButton,
} from "@better-agent/ui/components/conversation";
import { Loader } from "@better-agent/ui/components/loader";
import { Message, MessageContent } from "@better-agent/ui/components/message";
import {
	PromptInput,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
	PromptInputTools,
} from "@better-agent/ui/components/prompt-input";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@better-agent/ui/components/reasoning";
import { Response } from "@better-agent/ui/components/response";
import { useState } from "react";

import { type ChatMessage, useChat } from "./use-chat";

function AssistantBody({ message }: { message: ChatMessage }) {
	const streamingEmpty = message.status === "streaming" && message.text === "";
	return (
		<div className="flex flex-col gap-2">
			{message.reasoning === "" ? null : (
				<Reasoning isStreaming={message.status === "streaming"}>
					<ReasoningTrigger label="Reasoning" />
					<ReasoningContent>{message.reasoning}</ReasoningContent>
				</Reasoning>
			)}
			{streamingEmpty ? <Loader /> : <Response>{message.text}</Response>}
			{message.status === "error" ? (
				<Badge variant="destructive">error</Badge>
			) : null}
			{message.status === "complete" && message.text !== "" ? (
				<CopyAction text={message.text} />
			) : null}
		</div>
	);
}

function ChatRow({ message }: { message: ChatMessage }) {
	if (message.role === "user") {
		return (
			<Message from="user">
				<MessageContent from="user">
					<p className="whitespace-pre-wrap text-sm">{message.text}</p>
				</MessageContent>
			</Message>
		);
	}
	return (
		<Message from="assistant">
			<MessageContent className="bg-transparent px-0 py-0" from="assistant">
				<AssistantBody message={message} />
			</MessageContent>
		</Message>
	);
}

export function Conversation({ sessionId }: { sessionId: string }) {
	const { messages, streaming, send, stop } = useChat(sessionId);
	const [text, setText] = useState("");
	const submit = () => {
		const trimmed = text.trim();
		if (trimmed === "" || streaming) {
			return;
		}
		send(trimmed);
		setText("");
	};
	return (
		<Card className="flex h-chat flex-col gap-0 overflow-hidden p-0">
			<ConversationRoot>
				<ConversationContent>
					{messages.length === 0 ? (
						<p className="text-muted-foreground text-sm">No messages yet.</p>
					) : (
						messages.map((message) => (
							<ChatRow key={message.id} message={message} />
						))
					)}
				</ConversationContent>
				<ConversationScrollButton />
			</ConversationRoot>
			<div className="border-t p-3">
				<PromptInput onSubmit={submit}>
					<PromptInputTextarea
						disabled={streaming}
						onChange={setText}
						onSubmit={submit}
						value={text}
					/>
					<PromptInputToolbar>
						<PromptInputTools />
						<PromptInputSubmit
							onStop={stop}
							status={streaming ? "streaming" : "idle"}
						/>
					</PromptInputToolbar>
				</PromptInput>
			</div>
		</Card>
	);
}
