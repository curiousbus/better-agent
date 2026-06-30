import { CopyAction } from "@better-agent/ui/components/actions";
import { Avatar, AvatarFallback } from "@better-agent/ui/components/avatar";
import { Bubble, BubbleContent } from "@better-agent/ui/components/bubble";
import {
	Message,
	MessageAvatar,
	MessageContent,
} from "@better-agent/ui/components/message";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@better-agent/ui/components/reasoning";
import { Response } from "@better-agent/ui/components/response";
import type { AgentClient } from "@curiousbus/agent-client";
import { BotIcon, TriangleAlertIcon, UserIcon } from "lucide-react";
import type { ReactNode } from "react";

import { AttachmentImage } from "./attachment-image";
import { type ChatBlock, type ChatMessage, messageText } from "./chat-blocks";
import { ToolGroup } from "./tool";

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

function AssistantContent({
	message,
	renderTree,
	hasTree,
	streaming,
}: {
	message: ChatMessage;
	renderTree?: (tree: unknown) => ReactNode;
	hasTree: boolean;
	streaming: boolean;
}) {
	if (hasTree) {
		return <>{renderTree?.(message.structured)}</>;
	}
	return (
		<>
			{message.blocks.map((block, index) => (
				<BlockView
					block={block}
					// biome-ignore lint/suspicious/noArrayIndexKey: blocks are append-only and never reorder
					key={`${index}-${block.kind}`}
					streaming={streaming}
				/>
			))}
		</>
	);
}

// Only the LIVE draft shimmers "Thinking…"; a refetched (or stopped/orphaned)
// message stuck in `streaming` status must not shimmer forever.
function isThinking(message: ChatMessage, hasTree: boolean): boolean {
	return (
		message.live === true &&
		message.status === "streaming" &&
		message.blocks.length === 0 &&
		!hasTree
	);
}

function AssistantBody({
	message,
	renderTree,
}: {
	message: ChatMessage;
	renderTree?: (tree: unknown) => ReactNode;
}) {
	const streaming = message.status === "streaming";
	const fullText = messageText(message);
	const hasTree = message.structured !== undefined && renderTree !== undefined;
	const showThinking = isThinking(message, hasTree);
	return (
		<div className="flex flex-col gap-2">
			{showThinking ? (
				<span className="shimmer font-medium text-sm">Thinking…</span>
			) : null}
			<AssistantContent
				hasTree={hasTree}
				message={message}
				renderTree={renderTree}
				streaming={streaming}
			/>
			{message.status === "stopped" ? (
				<span className="text-muted-foreground text-sm">Stopped.</span>
			) : null}
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

function UserRow({
	message,
	agentClient,
}: {
	message: ChatMessage;
	agentClient: AgentClient;
}) {
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

export function ChatRow({
	message,
	agentClient,
	renderTree,
}: {
	message: ChatMessage;
	agentClient: AgentClient;
	renderTree?: (tree: unknown) => ReactNode;
}) {
	if (message.role === "user") {
		return <UserRow agentClient={agentClient} message={message} />;
	}
	return (
		<Message align="start">
			<RoleAvatar from="assistant" />
			<MessageContent>
				<Bubble variant="ghost">
					<BubbleContent className="text-sm">
						<AssistantBody message={message} renderTree={renderTree} />
					</BubbleContent>
				</Bubble>
			</MessageContent>
		</Message>
	);
}
