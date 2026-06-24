import type { AgentClient } from "@better-agent/client";
import { CopyAction } from "@better-agent/ui/components/actions";
import { Badge } from "@better-agent/ui/components/badge";
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
import { useEffect, useRef, useState } from "react";

import { RevealText } from "./reveal-text";

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
			{streamingEmpty ? (
				<Loader />
			) : (
				<Response isAnimating={message.status === "streaming"}>
					{message.text}
				</Response>
			)}
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

function ChatComposer({
	streaming,
	onSend,
	onStop,
}: {
	streaming: boolean;
	onSend: (text: string) => void;
	onStop: () => void;
}) {
	const [text, setText] = useState("");
	const submit = () => {
		const trimmed = text.trim();
		if (trimmed === "" || streaming) {
			return;
		}
		onSend(trimmed);
		setText("");
	};
	return (
		<div className="shrink-0 px-4 pb-4">
			<div className="mx-auto w-full max-w-3xl">
				<PromptInput
					className="rounded-2xl border bg-background p-2 shadow-sm"
					onSubmit={submit}
				>
					<PromptInputTextarea
						disabled={streaming}
						onChange={setText}
						onSubmit={submit}
						placeholder="Send a message…"
						value={text}
					/>
					<PromptInputToolbar>
						<PromptInputTools />
						<PromptInputSubmit
							onStop={onStop}
							status={streaming ? "streaming" : "idle"}
						/>
					</PromptInputToolbar>
				</PromptInput>
			</div>
		</div>
	);
}

function EmptyMessages() {
	return (
		<div className="flex flex-col items-center justify-center py-24 text-center">
			<RevealText>
				<p className="t-stagger-line t-stagger-line--1 font-medium text-sm">
					Start the conversation
				</p>
				<p className="t-stagger-line t-stagger-line--2 text-muted-foreground text-sm">
					Send a message to begin.
				</p>
			</RevealText>
		</div>
	);
}

export function Conversation({
	sessionId,
	agentClient,
	initialText,
}: {
	sessionId: string;
	agentClient: AgentClient;
	initialText?: string;
}) {
	const { messages, streaming, send, stop } = useChat(sessionId, agentClient);
	const sentRef = useRef(false);
	useEffect(() => {
		if (initialText && !sentRef.current) {
			sentRef.current = true;
			send(initialText);
		}
	}, [initialText, send]);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ConversationRoot>
				<ConversationContent className="mx-auto w-full max-w-3xl">
					{messages.length === 0 ? (
						<EmptyMessages />
					) : (
						messages.map((message) => (
							<ChatRow key={message.id} message={message} />
						))
					)}
				</ConversationContent>
				<ConversationScrollButton />
			</ConversationRoot>
			<ChatComposer onSend={send} onStop={stop} streaming={streaming} />
		</div>
	);
}
