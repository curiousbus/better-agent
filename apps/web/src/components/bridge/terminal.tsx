import type { ChatAvatars } from "@better-agent/ui/components/chat/chat-row";
import { useMemo } from "react";
import type { BridgeSessionRow } from "@/utils/api-types";
import { agentAvatar } from "@/utils/avatar";
import { type AgentCapabilities, capabilities } from "./agent-capabilities";
import type { StreamEvent } from "./bridge-events";
import {
	type SessionReadyDetail,
	TURN_END_STATUS,
	TURN_USAGE_STATUS,
	type TurnUsageDetail,
} from "./bridge-session-status";
import type { BridgeTransport } from "./bridge-transport";
import { type BridgeTurn, foldEventsToTurns } from "./bridge-turns";
import { TerminalComposer } from "./terminal-composer";
import { TerminalFeed } from "./terminal-feed";
import { TerminalHeader } from "./terminal-header";
import { TurnUsagePanel } from "./turn-usage-panel";
import { useBridgeTerminal } from "./use-bridge-terminal";

export interface TerminalProps {
	/** Whether an end-session request is in flight — disables the End button.
	 * Only meaningful alongside `onEnd`. */
	ending?: boolean;
	/** Ends this session. Wired by the detail page; omitted (with the End
	 * button then hidden) when there's no session to end, e.g. in unit tests. */
	onEnd?: () => void;
	session: BridgeSessionRow;
	transport: BridgeTransport;
	/** Dicebear URL for the current user's bubbles; falls back to a role icon
	 * when absent (e.g. the email hasn't loaded yet). */
	userAvatarUrl?: string;
}

interface TerminalBodyProps {
	answerApproval: (requestId: string, optionId: string) => Promise<void>;
	answered: Record<string, string>;
	avatars: ChatAvatars;
	caps: AgentCapabilities;
	disabled: boolean;
	ended: boolean;
	interrupt: () => void;
	onSend: (text: string) => Promise<void>;
	sending: boolean;
	sessionReady: SessionReadyDetail | null;
	setModel: (model: string) => void;
	setPermissionMode: (mode: string) => void;
	turnInFlight: boolean;
	turns: BridgeTurn[];
	turnUsage: TurnUsageDetail | null;
}

interface BodyComposerProps {
	caps: AgentCapabilities;
	disabled: boolean;
	interrupt: () => void;
	onSend: (text: string) => Promise<void>;
	sending: boolean;
	sessionReady: SessionReadyDetail | null;
	setModel: (model: string) => void;
	setPermissionMode: (mode: string) => void;
	turnInFlight: boolean;
}

/** The composer with its capability-gated control menus fed from the session's
 * reported model/permission values — split out of `TerminalBody` purely to keep
 * that component under the repo's max-lines-per-function gate. */
function BodyComposer({
	caps,
	disabled,
	interrupt,
	onSend,
	sending,
	sessionReady,
	setModel,
	setPermissionMode,
	turnInFlight,
}: BodyComposerProps) {
	return (
		<TerminalComposer
			canInterrupt={caps.interrupt}
			disabled={disabled}
			model={sessionReady?.model}
			models={sessionReady?.models}
			onInterrupt={interrupt}
			onSend={onSend}
			onSetModel={setModel}
			onSetPermissionMode={setPermissionMode}
			permissionMode={sessionReady?.permissionMode}
			permissionModes={caps.permissionModes}
			sending={sending}
			skills={caps.skills ? sessionReady?.skills : undefined}
			slashCommands={
				caps.slashCommands ? sessionReady?.slashCommands : undefined
			}
			turnInFlight={turnInFlight}
		/>
	);
}

/** The feed, the (capability-gated) usage chip, and the composer — split out
 * of `Terminal` purely to keep that component under the repo's
 * max-lines-per-function gate. The composer now carries the model /
 * permission-mode menus and the Stop button (see terminal-composer.tsx). */
function TerminalBody(props: TerminalBodyProps) {
	return (
		<>
			<TerminalFeed
				answerApproval={props.answerApproval}
				answered={props.answered}
				avatars={props.avatars}
				ended={props.ended}
				sending={props.sending}
				turnInFlight={props.turnInFlight}
				turns={props.turns}
			/>
			{props.caps.usageMode === "stream" && (
				<TurnUsagePanel detail={props.turnUsage} />
			)}
			<BodyComposer
				caps={props.caps}
				disabled={props.disabled}
				interrupt={props.interrupt}
				onSend={props.onSend}
				sending={props.sending}
				sessionReady={props.sessionReady}
				setModel={props.setModel}
				setPermissionMode={props.setPermissionMode}
				turnInFlight={props.turnInFlight}
			/>
		</>
	);
}

/** True for the WHOLE in-flight turn: from the user's latest message until a
 * turn-completion status (claude → `turn_usage`, pi/opencode → `turn_end`).
 * Scanning tail-first, a completion before any user message means the last turn
 * already finished; a user message first means we're mid-turn. This — not
 * `awaitingFirstToken` — gates the persistent working indicator, so a long tool
 * run no longer looks frozen after the first token. */
function deriveTurnInFlight(events: StreamEvent[], ended: boolean): boolean {
	if (ended) {
		return false;
	}
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i].event;
		if (
			event.kind === "status" &&
			(event.status === TURN_USAGE_STATUS || event.status === TURN_END_STATUS)
		) {
			return false;
		}
		if (event.kind === "message" && event.role === "user") {
			return true;
		}
	}
	return false;
}

/** Wires `useBridgeTerminal` to this session plus the derived turns/avatars —
 * split out purely to keep `Terminal` itself under the repo's
 * max-lines-per-function gate. */
function useTerminalView(
	session: BridgeSessionRow,
	transport: BridgeTransport,
	userAvatarUrl: string | undefined
) {
	const bridge = useBridgeTerminal(
		session.id,
		transport,
		session.status === "ended"
	);
	const ended = session.status === "ended";
	const turns = useMemo(
		() => foldEventsToTurns(bridge.events),
		[bridge.events]
	);
	const turnInFlight = useMemo(
		() => deriveTurnInFlight(bridge.events, ended),
		[bridge.events, ended]
	);
	const avatars: ChatAvatars = {
		assistant: agentAvatar(session.tokenId),
		user: userAvatarUrl,
	};
	return { ...bridge, turns, avatars, turnInFlight };
}

/**
 * Live view of one bridge session: header shows connection status, body is
 * the auto-scrolling, ordered/deduped normalized-event feed, footer is the
 * input box that posts via `sendInput`. `transport` is always injected
 * (real one from bridge-transport.ts in the route, a fake in tests) —
 * mirrors `Conversation`'s injected `AgentClient`.
 */
export function Terminal({
	ending = false,
	onEnd,
	session,
	transport,
	userAvatarUrl,
}: TerminalProps) {
	const view = useTerminalView(session, transport, userAvatarUrl);
	const caps = capabilities(session.agentKind);
	// The claude/agent session id when the CLI has reported one, else the
	// bridge session id — never the (routinely "untitled") session label.
	const sessionId = view.sessionReady?.sessionId ?? session.id;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<TerminalHeader
				agentKind={session.agentKind}
				canSend={view.canSend}
				caps={caps}
				ending={ending}
				listSessions={view.listSessions}
				onEnd={onEnd}
				sessionId={sessionId}
				sessionList={view.sessionList}
				sessionReady={view.sessionReady}
				status={view.status}
			/>
			<TerminalBody
				answerApproval={view.answerApproval}
				answered={view.answered}
				avatars={view.avatars}
				caps={caps}
				disabled={!view.canSend}
				ended={view.status === "ended"}
				interrupt={view.interrupt}
				onSend={view.sendInput}
				sending={view.sending}
				sessionReady={view.sessionReady}
				setModel={view.setModel}
				setPermissionMode={view.setPermissionMode}
				turnInFlight={view.turnInFlight}
				turns={view.turns}
				turnUsage={view.turnUsage}
			/>
		</div>
	);
}
