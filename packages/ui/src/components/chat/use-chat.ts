import type { AgentClient } from "@curiousbus/agent-client";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type { AttachmentRef, ChatBlock, ChatMessage } from "./chat-blocks";
import { toChatMessage } from "./chat-blocks";
import { type GenuiStreamConfig, streamPrompt } from "./chat-stream";

export type { GenuiStreamConfig } from "./chat-stream";
export { streamPrompt } from "./chat-stream";

// Query key for a session's message history, fetched through the Agent SDK
// (token-scoped) rather than the unauthenticated oRPC client.
const messagesKey = (sessionId: string) =>
	["agent", "messages", sessionId] as const;

interface SendArgs {
	abortRef: React.MutableRefObject<AbortController | null>;
	agentClient: AgentClient;
	genui?: GenuiStreamConfig;
	queryClient: QueryClient;
	sessionId: string;
	setDraft: (msgs: ChatMessage[]) => void;
	setStreaming: (v: boolean) => void;
	streaming: boolean;
}

async function finalizeSend(sessionId: string, args: SendArgs) {
	args.setStreaming(false);
	args.abortRef.current = null;
	await args.queryClient.invalidateQueries({
		queryKey: messagesKey(sessionId),
	});
	args.setDraft([]);
}

function userDraftBlocks(
	text: string,
	attachments: AttachmentRef[]
): ChatBlock[] {
	const blocks: ChatBlock[] = [];
	if (text.length > 0) {
		blocks.push({ kind: "text", text });
	}
	for (const file of attachments) {
		blocks.push({ kind: "file", file });
	}
	return blocks;
}

async function sendMessage(
	text: string,
	attachments: AttachmentRef[],
	args: SendArgs
) {
	if (args.sessionId === "" || args.streaming) {
		return;
	}
	const controller = new AbortController();
	args.abortRef.current = controller;
	args.setStreaming(true);
	const user: ChatMessage = {
		id: "draft-user",
		role: "user",
		status: "complete",
		blocks: userDraftBlocks(text, attachments),
	};
	const assistant: ChatMessage = {
		id: "draft-assistant",
		role: "assistant",
		status: "streaming",
		blocks: [],
		live: true,
	};
	args.setDraft([user, assistant]);
	try {
		await streamPrompt({
			agentClient: args.agentClient,
			sessionId: args.sessionId,
			text,
			signal: controller.signal,
			user,
			assistant,
			setDraft: args.setDraft,
			attachmentIds: attachments.map((a) => a.attachmentId),
			genui: args.genui,
		});
	} catch {
		if (!controller.signal.aborted) {
			assistant.status = "error";
			args.setDraft([user, { ...assistant, blocks: [...assistant.blocks] }]);
		}
	} finally {
		await finalizeSend(args.sessionId, args);
	}
}

export function useChat(
	sessionId: string,
	agentClient: AgentClient,
	genui?: GenuiStreamConfig
) {
	const queryClient = useQueryClient();
	const history = useQuery({
		queryKey: messagesKey(sessionId),
		queryFn: () => agentClient.listMessages(sessionId),
		enabled: sessionId !== "",
	});
	const [draft, setDraft] = useState<ChatMessage[]>([]);
	const [streaming, setStreaming] = useState(false);
	const abortRef = useRef<AbortController | null>(null);

	// Abort an in-flight stream when the session switches or the page unmounts.
	useEffect(() => () => abortRef.current?.abort(), []);

	const messages: ChatMessage[] = [
		...(history.data ?? []).map(toChatMessage),
		...draft,
	];

	const send = (text: string, attachments: AttachmentRef[] = []) =>
		sendMessage(text, attachments, {
			agentClient,
			sessionId,
			streaming,
			abortRef,
			setStreaming,
			setDraft,
			queryClient,
			genui,
		});

	const stop = () => {
		abortRef.current?.abort();
		// Reflect the stop immediately: mark the in-flight assistant draft stopped
		// (so it stops showing "Thinking…") and free the composer, without waiting
		// for the stream to actually unwind.
		setStreaming(false);
		setDraft((prev) =>
			prev.map((message) =>
				message.role === "assistant" && message.status === "streaming"
					? { ...message, status: "stopped" }
					: message
			)
		);
		if (sessionId !== "") {
			agentClient.cancel(sessionId).catch(() => undefined);
		}
	};

	return { messages, streaming, send, stop };
}
