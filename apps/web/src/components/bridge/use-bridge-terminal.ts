import { type Dispatch, useReducer, useState } from "react";
import { toast } from "sonner";
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
import {
	type FeedAction,
	feedReducer,
	initialFeedState,
} from "./use-bridge-feed";

export interface UseBridgeTerminalResult {
	answerApproval: (requestId: string, optionId: string) => Promise<void>;
	answered: Record<string, string>;
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

const APPROVAL_SEND_FAILURE_MESSAGE =
	"Couldn't send that decision — try again.";

/**
 * Builds the approval-decision callback: marks it answered in the feed
 * store immediately (so the buttons disable and the chosen option shows
 * before the network round trip settles — no window for a double-click to
 * send twice), then relays the decision as the `{ type: "approval",
 * requestId, optionId }` command the CLI's `commands.ts` parses back out.
 * If that send rejects, the optimistic mark is rolled back — approvals gate
 * destructive operations, so a decision that never reached the agent must
 * not sit there looking answered — and a toast surfaces the failure so the
 * user knows to retry. Not itself a hook — takes the dispatch/sendInput a
 * hook already produced.
 */
function makeAnswerApproval(
	dispatchFeed: Dispatch<FeedAction>,
	sendInput: (text: string) => Promise<void>
) {
	return async (requestId: string, optionId: string): Promise<void> => {
		dispatchFeed({ type: "answer", requestId, optionId });
		try {
			await sendInput(
				JSON.stringify({ type: "approval", requestId, optionId })
			);
		} catch (error) {
			dispatchFeed({ type: "unanswer", requestId });
			const message =
				error instanceof Error ? error.message : APPROVAL_SEND_FAILURE_MESSAGE;
			toast.error(message);
		}
	};
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
	const answerApproval = makeAnswerApproval(dispatchFeed, sendInput);

	return {
		events: feed.events,
		status: conn.status,
		canSend: conn.everConnected,
		sending,
		sendInput,
		answered: feed.answered,
		answerApproval,
	};
}
