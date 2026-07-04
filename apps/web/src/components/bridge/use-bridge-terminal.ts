import { useReducer, useState } from "react";
import type { StreamEvent } from "./bridge-events";
import type { BridgeTransport } from "./bridge-transport";
import {
	type ConnectionStatus,
	connectionReducer,
	initialConnectionState,
} from "./terminal-connection";
import {
	useMaxSeenIdRef,
	usePollFallback,
	useResetOnSessionChange,
	useSseConnection,
} from "./use-bridge-connection-effects";
import { feedReducer, initialFeedState } from "./use-bridge-feed";

export interface UseBridgeTerminalResult {
	canSend: boolean;
	events: StreamEvent[];
	sendInput: (text: string) => Promise<void>;
	sending: boolean;
	status: ConnectionStatus;
}

function useSendInput(sessionId: string, transport: BridgeTransport) {
	const [sending, setSending] = useState(false);
	const sendInput = async (text: string): Promise<void> => {
		setSending(true);
		try {
			await transport.sendInput({ sessionId, data: text });
		} finally {
			setSending(false);
		}
	};
	return { sending, sendInput };
}

/**
 * Drives a bridge session's terminal feed: SSE-first with poll-fallback
 * degrade (see use-bridge-connection-effects.ts), deduped/ordered by id (see
 * event-feed.ts), plus the sendInput mutation. `transport` is injected so
 * this hook — and anything built on it — can be tested against a fake
 * instead of real network/oRPC calls.
 */
export function useBridgeTerminal(
	sessionId: string,
	transport: BridgeTransport
): UseBridgeTerminalResult {
	const [feed, dispatchFeed] = useReducer(feedReducer, initialFeedState);
	const [conn, dispatchConn] = useReducer(
		connectionReducer,
		initialConnectionState
	);
	useResetOnSessionChange(sessionId, dispatchFeed, dispatchConn);
	const maxSeenIdRef = useMaxSeenIdRef(feed.maxSeenId);
	useSseConnection({
		sessionId,
		conn,
		maxSeenIdRef,
		transport,
		dispatchFeed,
		dispatchConn,
	});
	usePollFallback({
		sessionId,
		status: conn.status,
		maxSeenIdRef,
		transport,
		dispatchFeed,
		dispatchConn,
	});
	const { sending, sendInput } = useSendInput(sessionId, transport);

	return {
		events: feed.events,
		status: conn.status,
		canSend: conn.everConnected,
		sending,
		sendInput,
	};
}
