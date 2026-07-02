import type { ChatMessage } from "./chat-blocks";

export interface ChatSessionState {
	/** History rows visible when the send started — while a draft exists, the
	 * merged view shows history only up to here, so the turn's freshly-persisted
	 * rows never render alongside the draft (a one-frame duplicate flash). */
	baseHistoryCount: number;
	draft: ChatMessage[];
	streaming: boolean;
}

export interface ChatSessionStore {
	/** Abort the in-flight stream (stop button / explicit cancel only). */
	abort(): void;
	getSnapshot(): ChatSessionState;
	setBaseHistoryCount(count: number): void;
	setController(controller: AbortController | null): void;
	setDraft(draft: ChatMessage[]): void;
	setStreaming(streaming: boolean): void;
	subscribe(listener: () => void): () => void;
}

function createChatSessionStore(): ChatSessionStore {
	let state: ChatSessionState = {
		draft: [],
		streaming: false,
		baseHistoryCount: 0,
	};
	let controller: AbortController | null = null;
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const listener of listeners) {
			listener();
		}
	};
	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSnapshot: () => state,
		setDraft(draft) {
			state = { ...state, draft };
			notify();
		},
		setStreaming(streaming) {
			state = { ...state, streaming };
			notify();
		},
		setBaseHistoryCount(count) {
			state = { ...state, baseHistoryCount: count };
			notify();
		},
		setController(next) {
			controller = next;
		},
		abort() {
			controller?.abort();
			controller = null;
		},
	};
}

// Streams OUTLIVE the chat screen: state lives here (module scope), keyed by
// session, so navigating away neither aborts the stream nor loses the draft —
// remounting resubscribes and the output keeps flowing. Only the stop button
// (or a server cancel) ends a turn early.
const stores = new Map<string, ChatSessionStore>();

export function chatSession(sessionId: string): ChatSessionStore {
	let store = stores.get(sessionId);
	if (!store) {
		store = createChatSessionStore();
		stores.set(sessionId, store);
	}
	return store;
}
