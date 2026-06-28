import { CopyAction } from "@better-agent/ui/components/actions";
import { Avatar, AvatarFallback } from "@better-agent/ui/components/avatar";
import { Bubble, BubbleContent } from "@better-agent/ui/components/bubble";
import {
	Message,
	MessageAvatar,
	MessageContent,
} from "@better-agent/ui/components/message";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@better-agent/ui/components/message-scroller";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@better-agent/ui/components/reasoning";
import { Response } from "@better-agent/ui/components/response";
import type { AgentClient } from "@curiousbus/agent-client";
import { BotIcon, TriangleAlertIcon, UserIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";

import { AttachmentImage } from "./attachment-image";
import { type ChatBlock, type ChatMessage, messageText } from "./chat-blocks";
import { ChatComposer } from "./chat-composer";
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
	if (block.kind === "text") {
		return <Response isAnimating={streaming}>{block.text}</Response>;
	}
	// `file` blocks belong to user messages and render outside the assistant body.
	return null;
}

function AssistantBody({ message }: { message: ChatMessage }) {
	const streaming = message.status === "streaming";
	const fullText = messageText(message);
	return (
		<div className="flex flex-col gap-2">
			{streaming && message.blocks.length === 0 ? (
				<span className="shimmer font-medium text-sm">Thinking…</span>
			) : null}
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

function RoleAvatar({ from }: { from: "user" | "assistant" }) {
	return (
		<MessageAvatar>
			<Avatar>
				<AvatarFallback>
					{from === "user" ? (
						<UserIcon className="size-4" />
					) : (
						<BotIcon className="size-4" />
					)}
				</AvatarFallback>
			</Avatar>
		</MessageAvatar>
	);
}

function fileBlocks(
	message: ChatMessage
): Extract<ChatBlock, { kind: "file" }>[] {
	return message.blocks.filter(
		(b): b is Extract<ChatBlock, { kind: "file" }> => b.kind === "file"
	);
}

function ChatRow({
	message,
	agentClient,
}: {
	message: ChatMessage;
	agentClient: AgentClient;
}) {
	if (message.role === "user") {
		const text = messageText(message);
		const files = fileBlocks(message);
		return (
			<Message align="end">
				<RoleAvatar from="user" />
				<MessageContent>
					{files.length > 0 ? (
						<div className="flex flex-wrap justify-end gap-2">
							{files.map((b) => (
								<AttachmentImage
									agentClient={agentClient}
									file={b.file}
									key={b.file.attachmentId}
								/>
							))}
						</div>
					) : null}
					{text.length > 0 ? (
						<Bubble align="end">
							<BubbleContent className="whitespace-pre-wrap text-sm">
								{text}
							</BubbleContent>
						</Bubble>
					) : null}
				</MessageContent>
			</Message>
		);
	}
	return (
		<Message align="start">
			<RoleAvatar from="assistant" />
			<MessageContent>
				<Bubble variant="ghost">
					<BubbleContent className="text-sm">
						<AssistantBody message={message} />
					</BubbleContent>
				</Bubble>
			</MessageContent>
		</Message>
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

function ChatScroller({
	messages,
	agentClient,
}: {
	messages: ChatMessage[];
	agentClient: AgentClient;
}) {
	return (
		<MessageScrollerProvider autoScroll defaultScrollPosition="end">
			<MessageScroller>
				<MessageScrollerViewport>
					<MessageScrollerContent className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-4">
						{messages.length === 0 ? (
							<EmptyMessages />
						) : (
							messages.map((message, index) => (
								<MessageScrollerItem
									key={message.id}
									scrollAnchor={index === messages.length - 1}
								>
									<ChatRow agentClient={agentClient} message={message} />
								</MessageScrollerItem>
							))
						)}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
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
			<ChatScroller agentClient={agentClient} messages={messages} />
			<ChatComposer
				agentClient={agentClient}
				onSend={send}
				onStop={stop}
				sessionId={sessionId}
				streaming={streaming}
			/>
		</div>
	);
}
