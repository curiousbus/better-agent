import type { AgentClient, MessageHistory } from "@curiousbus/agent-client";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type MutableRefObject, useRef, useSyncExternalStore } from "react";

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

// ── observing mode ───────────────────────────────────────────────────────────
// Turns run detached on the server (parts persist progressively). After a
// reload there is no local stream, but the trailing assistant message is still
// `streaming` — so we OBSERVE it: poll history until it completes. A turn whose
// content stops changing for too long is treated as orphaned and left alone.
const OBSERVE_POLL_MS = 1500;
const STALL_MS = 120_000;

type StallRef = MutableRefObject<{ fingerprint: string; since: number } | null>;

function liveTrailingTurn(rows: MessageHistory | undefined) {
	const last = rows?.at(-1);
	return last &&
		last.message.role === "assistant" &&
		last.message.status === "streaming"
		? last
		: null;
}

function turnFingerprint(row: MessageHistory[number]): string {
	return `${row.message.id}:${row.parts.length}:${JSON.stringify(row.parts).length}`;
}

function observePollInterval(
	rows: MessageHistory | undefined,
	stallRef: StallRef
): number | false {
	const live = liveTrailingTurn(rows);
	if (!live) {
		stallRef.current = null;
		return false;
	}
	const fingerprint = turnFingerprint(live);
	const now = Date.now();
	if (stallRef.current?.fingerprint !== fingerprint) {
		stallRef.current = { fingerprint, since: now };
	}
	return now - stallRef.current.since > STALL_MS ? false : OBSERVE_POLL_MS;
}

function isObserving(
	rows: MessageHistory | undefined,
	stallRef: StallRef
): boolean {
	if (!liveTrailingTurn(rows)) {
		return false;
	}
	const stall = stallRef.current;
	return !(stall && Date.now() - stall.since > STALL_MS);
}

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
	// The history observer is still DISABLED in this tick (it re-enables when the
	// streaming flag lands on the next render), so invalidateQueries would no-op
	// and resolve immediately — clearing the draft against an empty cache blanks
	// a fresh session. Fetch imperatively instead: the cache holds the completed
	// turn BEFORE the draft goes away.
	try {
		await args.queryClient.fetchQuery({
			queryKey: messagesKey(args.sessionId),
			queryFn: () => args.agentClient.listMessages(args.sessionId),
		});
		args.store.setDraft([]);
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
	const stallRef: StallRef = useRef(null);
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

	// `streaming` also covers observing a detached server-side turn, so the
	// composer stays disabled and Stop stays available after a reload.
	return { messages, streaming: streaming || observing, send, stop };
}
