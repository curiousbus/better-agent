import { type Dispatch, useReducer, useState } from "react";
import { toast } from "sonner";
import type { StreamEvent } from "./bridge-events";
import type { BridgeTransport } from "./bridge-transport";
import {
	connectionReducer,
	initialConnectionState,
} from "./terminal-connection";
import type { TerminalConnectionStatus } from "./terminal-status";
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
	status: TerminalConnectionStatus;
}

function useSendInput(
	sessionId: string,
	transport: BridgeTransport,
	dispatchFeed: Dispatch<FeedAction>
) {
	const [sending, setSending] = useState(false);
	const sendRaw = async (data: unknown): Promise<void> => {
		setSending(true);
		try {
			await transport.sendInput({ sessionId, data });
		} finally {
			setSending(false);
		}
	};
	// Plain chat send only: echo the user's own line into the feed immediately
	// (optimistic) BEFORE the round trip. `sendRaw` stays echo-free so approval
	// decisions never produce a fake chat line.
	const sendInput = (text: string): Promise<void> => {
		const trimmed = text.trim();
		dispatchFeed({ type: "localEcho", text: trimmed });
		return sendRaw(trimmed);
	};
	return { sending, sendInput, sendRaw };
}

const APPROVAL_SEND_FAILURE_MESSAGE =
	"Couldn't send that decision — try again.";

/**
 * Builds the approval-decision callback: marks it answered in the feed
 * store immediately (so the buttons disable and the chosen option shows
 * before the network round trip settles — no window for a double-click to
 * send twice), then relays the decision as the `{ type: "approval",
 * requestId, optionId }` command object the CLI's `commands.ts` parses back
 * out. This must go over the wire as an object, not a JSON string — the
 * CLI's `parseCommandText` treats any string as plain chat text (the string
 * check runs first), so a stringified approval would be typed into the
 * agent instead of routed to `answerApproval` and the approval would stall
 * forever. If the send rejects, the optimistic mark is rolled back —
 * approvals gate destructive operations, so a decision that never reached
 * the agent must not sit there looking answered — and a toast surfaces the
 * failure so the user knows to retry. Not itself a hook — takes the
 * dispatch/sendRaw a hook already produced.
 */
function makeAnswerApproval(
	dispatchFeed: Dispatch<FeedAction>,
	sendRaw: (data: unknown) => Promise<void>
) {
	return async (requestId: string, optionId: string): Promise<void> => {
		dispatchFeed({ type: "answer", requestId, optionId });
		try {
			await sendRaw({ type: "approval", requestId, optionId });
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
 *
 * `ended` marks a session the server has already closed out (`endSession`
 * was called, or it was already ended when the page loaded): both the SSE
 * and poll-fallback effects are disabled outright — there's no local CLI
 * left to reconnect to, so retrying would just spin forever — and the
 * reported `status` becomes `"ended"` regardless of whatever transient
 * connection state came before, with sending disabled to match.
 */
export function useBridgeTerminal(
	sessionId: string,
	transport: BridgeTransport,
	ended: boolean
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
		enabled: !ended,
		maxSeenIdRef,
		transport,
		dispatchFeed,
		dispatchConn,
	});
	usePollFallback({
		sessionId,
		status: conn.status,
		enabled: !ended,
		maxSeenIdRef,
		transport,
		dispatchFeed,
		dispatchConn,
	});
	const { sending, sendInput, sendRaw } = useSendInput(
		sessionId,
		transport,
		dispatchFeed
	);
	const answerApproval = makeAnswerApproval(dispatchFeed, sendRaw);

	return {
		events: feed.events,
		status: ended ? "ended" : conn.status,
		// Input (sendInput RPC → commands↓) and output (the SSE observe stream)
		// are INDEPENDENT channels: the CLI polls commands regardless of any SSE.
		// Gating send on `everConnected` (the OUTPUT stream having opened) meant a
		// failing/slow observe stream also silenced the input — the user could
		// neither send nor see anything. Send whenever the session is live.
		canSend: !ended,
		sending,
		sendInput,
		answered: feed.answered,
		answerApproval,
	};
}
