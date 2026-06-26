import type { AgentClient } from "@better-agent/client";
import { CopyAction } from "@better-agent/ui/components/actions";
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
import { TriangleAlertIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { type ChatBlock, type ChatMessage, messageText } from "./chat-blocks";
import { RevealText } from "./reveal-text";
import { ToolGroup } from "./tool";
import { useChat } from "./use-chat";

function BlockView({
	block,
	streaming,
}: {
	block: ChatBlock;
	streaming: boolean;
}) {
	if (block.kind === "reasoning") {
		return (
			<Reasoning isStreaming={streaming}>
				<ReasoningTrigger label="Reasoning" />
				<ReasoningContent>{block.text}</ReasoningContent>
			</Reasoning>
		);
	}
	if (block.kind === "tool") {
		return <ToolGroup tools={[block.tool]} />;
	}
	return <Response isAnimating={streaming}>{block.text}</Response>;
}

function AssistantBody({ message }: { message: ChatMessage }) {
	const streaming = message.status === "streaming";
	const fullText = messageText(message);
	return (
		<div className="flex flex-col gap-2">
			{streaming && message.blocks.length === 0 ? <Loader /> : null}
			{message.blocks.map((block, index) => (
				<BlockView
					block={block}
					// biome-ignore lint/suspicious/noArrayIndexKey: blocks are append-only and never reorder
					key={`${index}-${block.kind}`}
					streaming={streaming}
				/>
			))}
			{message.status === "error" ? (
				<div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive text-sm">
					<TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
					<span>
						{message.errorText ?? "Something went wrong. Please try again."}
					</span>
				</div>
			) : null}
			{message.status === "complete" && fullText !== "" ? (
				<CopyAction text={fullText} />
			) : null}
		</div>
	);
}

function ChatRow({ message }: { message: ChatMessage }) {
	if (message.role === "user") {
		return (
			<Message from="user">
				<MessageContent from="user">
					<p className="whitespace-pre-wrap text-sm">{messageText(message)}</p>
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
	const sendRef = useRef(send);
	useLayoutEffect(() => {
		sendRef.current = send;
	});
	// Send the first message once the chat mounts. Defer it: a transient
	// mount/unmount during the composer→chat slide (or a dev double-invoke)
	// cancels the stale schedule via cleanup instead of aborting an
	// already-started stream — so the send fires exactly once, after things
	// settle, and the first message is never lost.
	useEffect(() => {
		const id = initialText
			? setTimeout(() => sendRef.current(initialText), 0)
			: undefined;
		return () => {
			if (id !== undefined) {
				clearTimeout(id);
			}
		};
	}, [initialText]);
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
