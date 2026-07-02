import type { AgentClient } from "@curiousbus/agent-client";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import type { AttachmentRef, ChatBlock, ChatMessage } from "./chat-blocks";
import { toChatMessage } from "./chat-blocks";
import { type ChatSessionStore, chatSession } from "./chat-session-store";
import { type GenuiStreamConfig, streamPrompt } from "./chat-stream";

export type { GenuiStreamConfig } from "./chat-stream";
export { streamPrompt } from "./chat-stream";

// Query key for a session's message history, fetched through the Agent SDK
// (token-scoped) rather than the unauthenticated oRPC client.
const messagesKey = (sessionId: string) =>
	["agent", "messages", sessionId] as const;

interface SendArgs {
	agentClient: AgentClient;
	genui?: GenuiStreamConfig;
	queryClient: QueryClient;
	sessionId: string;
	store: ChatSessionStore;
}

async function finalizeSend(args: SendArgs) {
	args.store.setStreaming(false);
	args.store.setController(null);
	await args.queryClient.invalidateQueries({
		queryKey: messagesKey(args.sessionId),
	});
	args.store.setDraft([]);
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
	if (args.sessionId === "" || args.store.getSnapshot().streaming) {
		return;
	}
	const controller = new AbortController();
	args.store.setController(controller);
	args.store.setStreaming(true);
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
	args.store.setDraft([user, assistant]);
	try {
		await streamPrompt({
			agentClient: args.agentClient,
			sessionId: args.sessionId,
			text,
			signal: controller.signal,
			user,
			assistant,
			setDraft: (msgs) => args.store.setDraft(msgs),
			attachmentIds: attachments.map((a) => a.attachmentId),
			genui: args.genui,
		});
	} catch {
		if (!controller.signal.aborted) {
			assistant.status = "error";
			args.store.setDraft([
				user,
				{ ...assistant, blocks: [...assistant.blocks] },
			]);
		}
	} finally {
		await finalizeSend(args);
	}
}

function stopSession(
	store: ChatSessionStore,
	sessionId: string,
	agentClient: AgentClient
) {
	store.abort();
	// Reflect the stop immediately: mark the in-flight assistant draft stopped
	// (so it stops showing "Thinking…") and free the composer, without waiting
	// for the stream to actually unwind.
	store.setStreaming(false);
	store.setDraft(
		store
			.getSnapshot()
			.draft.map((message) =>
				message.role === "assistant" && message.status === "streaming"
					? { ...message, status: "stopped" }
					: message
			)
	);
	if (sessionId !== "") {
		agentClient.cancel(sessionId).catch(() => undefined);
	}
}

export function useChat(
	sessionId: string,
	agentClient: AgentClient,
	genui?: GenuiStreamConfig
) {
	const queryClient = useQueryClient();
	// The stream + draft live in a module-level per-session store, so navigating
	// away does NOT abort the turn — remounting resubscribes to the live output.
	const store = chatSession(sessionId);
	const { draft, streaming } = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot
	);
	const history = useQuery({
		queryKey: messagesKey(sessionId),
		queryFn: () => agentClient.listMessages(sessionId),
		// Paused while a turn streams: the server persists the turn's rows at turn
		// START, so a mid-stream (re)mount refetch would duplicate the live draft.
		// Cached history + draft is the correct view until finalize invalidates.
		enabled: sessionId !== "" && !streaming,
	});

	const messages: ChatMessage[] = [
		...(history.data ?? []).map(toChatMessage),
		...draft,
	];

	const send = (text: string, attachments: AttachmentRef[] = []) =>
		sendMessage(text, attachments, {
			agentClient,
			sessionId,
			store,
			queryClient,
			genui,
		});

	const stop = () => stopSession(store, sessionId, agentClient);

	return { messages, streaming, send, stop };
}
