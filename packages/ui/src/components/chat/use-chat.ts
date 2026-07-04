import type { AgentClient, MessageHistory } from "@curiousbus/agent-client";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type MutableRefObject,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";

import type { AttachmentRef, ChatBlock, ChatMessage } from "./chat-blocks";
import { toChatMessage } from "./chat-blocks";
import {
	isObserving,
	observePollInterval,
	type StallRef,
	turnLandedInHistory,
} from "./chat-observe";
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
	// Populate the history cache with the completed turn, but do NOT clear the
	// draft here. Clearing against the fetchQuery RETURN races the useQuery the
	// view reads: for a frame that hook still holds the pre-turn data, so the
	// turn vanishes until the observer catches up. Instead, this fetch updates
	// the cache, useQuery re-renders with the turn, and the reconcile EFFECT
	// (which keys on that same history.data) clears the draft in the render
	// where the turn is already on screen — a seamless swap, no empty frame.
	try {
		await args.queryClient.fetchQuery<MessageHistory>({
			queryKey: messagesKey(args.sessionId),
			queryFn: () => args.agentClient.listMessages(args.sessionId),
			// Bypass any app-level staleTime: within its freshness window
			// fetchQuery returns the CACHED pre-turn rows without a network hit.
			staleTime: 0,
		});
	} catch {
		// Fetch failed — keep the draft visible; a later refetch reconciles.
	}
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

// Freeze the visible history at its pre-send length: the server persists the
// turn's rows immediately, and any refetch landing mid-turn (or the finalize
// fetch) must not render them NEXT TO the draft (a duplicate flash).
function captureHistoryBaseline(args: SendArgs) {
	const cached = args.queryClient.getQueryData<unknown[]>(
		messagesKey(args.sessionId)
	);
	args.store.setBaseHistoryCount(cached?.length ?? 0);
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
	captureHistoryBaseline(args);
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

// Sticky last-non-empty messages, reset to empty whenever the session changes.
function useSessionResetRef(
	sessionId: string
): MutableRefObject<ChatMessage[]> {
	const lastMessagesRef = useRef<ChatMessage[]>([]);
	const sessionRef = useRef(sessionId);
	if (sessionRef.current !== sessionId) {
		sessionRef.current = sessionId;
		lastMessagesRef.current = [];
	}
	return lastMessagesRef;
}

// While a draft is on screen it owns the current turn: history is capped at its
// pre-send length so the persisted rows never double-render. Sticky guard: the
// draft→history handoff can momentarily yield an empty list in the real browser
// (the draft clears a beat before the query hook reflects the persisted turn);
// rendering [] flashes the empty state ("聊天窗口变白"). Once messages have been
// shown, never fall back to empty (the ref resets when the session changes).
function stickyMessages(
	rows: MessageHistory,
	draft: ChatMessage[],
	baseHistoryCount: number,
	lastRef: MutableRefObject<ChatMessage[]>
): ChatMessage[] {
	const visibleRows = draft.length > 0 ? rows.slice(0, baseHistoryCount) : rows;
	const computed = [...visibleRows.map(toChatMessage), ...draft];
	const messages =
		computed.length === 0 && lastRef.current.length > 0
			? lastRef.current
			: computed;
	lastRef.current = messages;
	return messages;
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
	const { draft, streaming, baseHistoryCount } = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot
	);
	const stallRef: StallRef = useRef(null);
	const lastMessagesRef = useSessionResetRef(sessionId);
	const history = useQuery({
		queryKey: messagesKey(sessionId),
		queryFn: () => agentClient.listMessages(sessionId),
		// Paused while a turn streams: the server persists the turn's rows at turn
		// START, so a mid-stream (re)mount refetch would duplicate the live draft.
		// Cached history + draft is the correct view until finalize invalidates.
		enabled: sessionId !== "" && !streaming,
		// Re-attach after a reload: while the trailing assistant message is still
		// streaming server-side, poll so the persisted parts keep flowing in.
		refetchInterval: (query) => observePollInterval(query.state.data, stallRef),
	});
	const observing = !streaming && isObserving(history.data, stallRef);

	// Reconcile a draft kept past finalize (stream died while the detached
	// server turn kept running): only once history PROVABLY contains the
	// finished turn (grew past the pre-send baseline + trailing complete) do
	// the persisted rows take over. Stale pre-turn history must never clear it.
	const hasDraft = draft.length > 0;
	useEffect(() => {
		if (
			!streaming &&
			hasDraft &&
			turnLandedInHistory(history.data, baseHistoryCount)
		) {
			store.setDraft([]);
		}
	}, [streaming, hasDraft, history.data, baseHistoryCount, store]);

	const messages = stickyMessages(
		history.data ?? [],
		draft,
		baseHistoryCount,
		lastMessagesRef
	);

	const send = (text: string, attachments: AttachmentRef[] = []) =>
		sendMessage(text, attachments, {
			agentClient,
			sessionId,
			store,
			queryClient,
			genui,
		});

	const stop = () => stopSession(store, sessionId, agentClient);

	// `streaming` also covers observing a detached server-side turn, so the
	// composer stays disabled and Stop stays available after a reload.
	return { messages, streaming: streaming || observing, send, stop };
}
