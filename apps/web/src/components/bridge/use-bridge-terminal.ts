import { type Dispatch, useMemo, useReducer, useState } from "react";
import { toast } from "sonner";
import type { StreamEvent } from "./bridge-events";
import {
	latestSessionReadyDetail,
	latestTurnUsageDetail,
	type SessionReadyDetail,
	type TurnUsageDetail,
} from "./bridge-session-status";
import type { BridgeTransport } from "./bridge-transport";
import {
	type ConnectionAction,
	type ConnectionState,
	connectionReducer,
	initialConnectionState,
} from "./terminal-connection";
import type { TerminalConnectionStatus } from "./terminal-status";
import {
	useHistorySeed,
	useMaxSeenIdRef,
	usePollFallback,
	useResetOnSessionChange,
	useSseConnection,
} from "./use-bridge-connection-effects";
import {
	type FeedAction,
	type FeedState,
	feedReducer,
	initialFeedState,
} from "./use-bridge-feed";

export interface UseBridgeTerminalResult {
	answerApproval: (requestId: string, optionId: string) => Promise<void>;
	answered: Record<string, string>;
	canSend: boolean;
	events: StreamEvent[];
	/** Cancels the in-flight turn without ending the session — the detail
	 * page's Stop/Interrupt button. Routed as `{ type: "control", action:
	 * "interrupt" }`; see `apps/bridge-cli/src/commands.ts`. */
	interrupt: () => Promise<void>;
	sendInput: (text: string) => Promise<void>;
	sending: boolean;
	/** The latest `session_ready` detail (model/cwd/capabilities/mcp), or
	 * `null` before the CLI's session has initialized — see
	 * bridge-session-status.ts. */
	sessionReady: SessionReadyDetail | null;
	/** Switches the model used for subsequent turns — the detail page's model
	 * picker. Routed as `{ type: "control", action: "setModel", model }`. */
	setModel: (model: string) => Promise<void>;
	/** Switches the session's permission mode — the detail page's mode
	 * dropdown. Routed as `{ type: "control", action: "setPermissionMode",
	 * mode }`. */
	setPermissionMode: (mode: string) => Promise<void>;
	status: TerminalConnectionStatus;
	/** The latest `turn_usage` detail (cost/tokens/turns), or `null` before
	 * any turn has completed. */
	turnUsage: TurnUsageDetail | null;
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

interface LatestSessionStatus {
	sessionReady: SessionReadyDetail | null;
	turnUsage: TurnUsageDetail | null;
}

/** Extracts the latest curated `session_ready`/`turn_usage` detail off the
 * feed — recomputed only when the event list itself changes, not on every
 * render (cheap either way, a tail scan, but no reason to redo it for e.g. a
 * `sending` state flip). Split out purely to keep `useBridgeTerminal` itself
 * under the repo's max-lines-per-function gate. */
function useLatestSessionStatus(events: StreamEvent[]): LatestSessionStatus {
	const sessionReady = useMemo(
		() => latestSessionReadyDetail(events),
		[events]
	);
	const turnUsage = useMemo(() => latestTurnUsageDetail(events), [events]);
	return { sessionReady, turnUsage };
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

const CONTROL_SEND_FAILURE_MESSAGE = "Couldn't send that — try again.";

/** One send for the detail page's session controls (interrupt/setModel/
 * setPermissionMode): relays `{ type: "control", action, ...extra }` over the
 * same `sendRaw` path `makeAnswerApproval` uses — an object, never a
 * stringified one, for the same reason approvals must go over as objects
 * (see that function's doc). Unlike a chat send, there's no feed echo and no
 * optimistic local state to roll back; a failure just toasts. */
function sendControlCommand(
	sendRaw: (data: unknown) => Promise<void>,
	action: string,
	extra?: Record<string, unknown>
): Promise<void> {
	return sendRaw({ type: "control", action, ...extra }).catch((error) => {
		const message =
			error instanceof Error ? error.message : CONTROL_SEND_FAILURE_MESSAGE;
		toast.error(message);
	});
}

interface SessionControls {
	interrupt: () => Promise<void>;
	setModel: (model: string) => Promise<void>;
	setPermissionMode: (mode: string) => Promise<void>;
}

/** Builds the detail page's session-control callbacks (Interrupt/model
 * picker/permission-mode dropdown) atop `sendControlCommand`. Split out
 * purely to keep `useBridgeTerminal` itself under the repo's
 * max-lines-per-function gate. */
function useSessionControls(
	sendRaw: (data: unknown) => Promise<void>
): SessionControls {
	return {
		interrupt: () => sendControlCommand(sendRaw, "interrupt"),
		setModel: (model: string) =>
			sendControlCommand(sendRaw, "setModel", { model }),
		setPermissionMode: (mode: string) =>
			sendControlCommand(sendRaw, "setPermissionMode", { mode }),
	};
}

interface LiveConnectionArgs {
	conn: ConnectionState;
	dispatchConn: Dispatch<ConnectionAction>;
	dispatchFeed: Dispatch<FeedAction>;
	ended: boolean;
	feed: FeedState;
	sessionId: string;
	transport: BridgeTransport;
}

/** Wires up the SSE-first/poll-fallback connection pipeline: history seed
 * gates the live SSE connection, which itself degrades to the poll fallback
 * (see use-bridge-connection-effects.ts for why each ordering matters). Split
 * out purely to keep `useBridgeTerminal` itself under the repo's
 * max-lines-per-function gate. */
function useLiveConnection({
	conn,
	dispatchConn,
	dispatchFeed,
	ended,
	feed,
	sessionId,
	transport,
}: LiveConnectionArgs): void {
	const historyLoaded = useHistorySeed({ sessionId, transport, dispatchFeed });
	const maxSeenIdRef = useMaxSeenIdRef(feed.maxSeenId);
	const enabled = !ended && historyLoaded;
	useSseConnection({
		sessionId,
		conn,
		enabled,
		maxSeenIdRef,
		transport,
		dispatchFeed,
		dispatchConn,
	});
	usePollFallback({
		sessionId,
		status: conn.status,
		enabled,
		maxSeenIdRef,
		transport,
		dispatchFeed,
		dispatchConn,
	});
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
	useLiveConnection({
		conn,
		dispatchConn,
		dispatchFeed,
		ended,
		feed,
		sessionId,
		transport,
	});
	const { sending, sendInput, sendRaw } = useSendInput(
		sessionId,
		transport,
		dispatchFeed
	);
	const answerApproval = makeAnswerApproval(dispatchFeed, sendRaw);
	const { sessionReady, turnUsage } = useLatestSessionStatus(feed.events);
	const { interrupt, setModel, setPermissionMode } =
		useSessionControls(sendRaw);

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
		interrupt,
		setModel,
		setPermissionMode,
		sessionReady,
		turnUsage,
	};
}
