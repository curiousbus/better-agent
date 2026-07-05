import type { ChatAvatars } from "@better-agent/ui/components/chat/chat-row";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@better-agent/ui/components/message-scroller";
import { useMemo } from "react";
import type { BridgeSessionRow } from "@/utils/api-types";
import { agentAvatar } from "@/utils/avatar";
import { BridgeChatRow } from "./bridge-chat-row";
import type {
	SessionListDetail,
	SessionReadyDetail,
} from "./bridge-session-status";
import type { BridgeTransport } from "./bridge-transport";
import { type BridgeTurn, foldEventsToTurns } from "./bridge-turns";
import { PastConversations } from "./past-conversations";
import { SessionStatusHeader } from "./session-status-header";
import { TerminalComposer } from "./terminal-composer";
import { TerminalControls } from "./terminal-controls";
import type { TerminalConnectionStatus } from "./terminal-status";
import { TerminalStatus } from "./terminal-status";
import { TurnUsageChip } from "./turn-usage-chip";
import { useBridgeTerminal } from "./use-bridge-terminal";

function EmptyTerminal() {
	return (
		<div className="flex flex-1 items-center justify-center py-24 text-center">
			<p className="text-muted-foreground text-sm">
				No output yet — waiting for the agent…
			</p>
		</div>
	);
}

interface TerminalFeedProps {
	answerApproval: (requestId: string, optionId: string) => Promise<void>;
	answered: Record<string, string>;
	avatars: ChatAvatars;
	ended: boolean;
	sending: boolean;
	turns: BridgeTurn[];
}

/** The scrolling conversation: bridge turns rendered as chat bubbles/lines. */
function TerminalFeed({
	answerApproval,
	answered,
	avatars,
	ended,
	sending,
	turns,
}: TerminalFeedProps) {
	return (
		<MessageScrollerProvider autoScroll defaultScrollPosition="end">
			<MessageScroller>
				<MessageScrollerViewport>
					<MessageScrollerContent className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-4">
						{turns.length === 0 ? (
							<EmptyTerminal />
						) : (
							turns.map((turn) => (
								<MessageScrollerItem key={turn.id}>
									<BridgeChatRow
										answered={answered}
										avatars={avatars}
										ended={ended}
										onAnswerApproval={answerApproval}
										sending={sending}
										turn={turn}
									/>
								</MessageScrollerItem>
							))
						)}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

export interface TerminalProps {
	session: BridgeSessionRow;
	transport: BridgeTransport;
	/** Dicebear URL for the current user's bubbles; falls back to a role icon
	 * when absent (e.g. the email hasn't loaded yet). */
	userAvatarUrl?: string;
}

interface TerminalHeaderProps {
	canSend: boolean;
	interrupt: () => void;
	label: string;
	listSessions: () => void;
	sessionList: SessionListDetail | null;
	sessionReady: SessionReadyDetail | null;
	setModel: (model: string) => void;
	setPermissionMode: (mode: string) => void;
	status: TerminalConnectionStatus;
}

/** The session title/connection-status row, the capability summary, and the
 * claude session controls (Interrupt/model/permission mode/past
 * conversations) — split out of `Terminal` purely to keep that component
 * under the repo's max-lines-per-function gate. */
function TerminalHeader({
	canSend,
	interrupt,
	label,
	listSessions,
	sessionList,
	sessionReady,
	setModel,
	setPermissionMode,
	status,
}: TerminalHeaderProps) {
	return (
		<div className="flex shrink-0 flex-col gap-1.5 border-b px-3 py-2">
			<div className="flex items-center justify-between gap-2">
				<span className="truncate font-medium text-sm">{label}</span>
				<TerminalStatus status={status} />
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<SessionStatusHeader detail={sessionReady} />
				<div className="flex flex-wrap items-center gap-1.5">
					<PastConversations
						disabled={!canSend}
						onRequestList={listSessions}
						sessionList={sessionList}
					/>
					<TerminalControls
						disabled={!canSend}
						model={sessionReady?.model}
						onInterrupt={interrupt}
						onSetModel={setModel}
						onSetPermissionMode={setPermissionMode}
						permissionMode={sessionReady?.permissionMode}
					/>
				</div>
			</div>
		</div>
	);
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
	const turns = useMemo(
		() => foldEventsToTurns(bridge.events),
		[bridge.events]
	);
	const avatars: ChatAvatars = {
		assistant: agentAvatar(session.tokenId),
		user: userAvatarUrl,
	};
	return { ...bridge, turns, avatars };
}

/**
 * Live view of one bridge session: header shows connection status, body is
 * the auto-scrolling, ordered/deduped normalized-event feed, footer is the
 * input box that posts via `sendInput`. `transport` is always injected
 * (real one from bridge-transport.ts in the route, a fake in tests) —
 * mirrors `Conversation`'s injected `AgentClient`.
 */
export function Terminal({ session, transport, userAvatarUrl }: TerminalProps) {
	const {
		status,
		canSend,
		sending,
		sendInput,
		answered,
		answerApproval,
		sessionReady,
		sessionList,
		turnUsage,
		interrupt,
		setModel,
		setPermissionMode,
		listSessions,
		turns,
		avatars,
	} = useTerminalView(session, transport, userAvatarUrl);

	return (
		<div className="flex min-h-0 flex-1 flex-col rounded-lg border">
			<TerminalHeader
				canSend={canSend}
				interrupt={interrupt}
				label={session.label ?? session.agentKind}
				listSessions={listSessions}
				sessionList={sessionList}
				sessionReady={sessionReady}
				setModel={setModel}
				setPermissionMode={setPermissionMode}
				status={status}
			/>
			<TerminalFeed
				answerApproval={answerApproval}
				answered={answered}
				avatars={avatars}
				ended={status === "ended"}
				sending={sending}
				turns={turns}
			/>
			<TurnUsageChip detail={turnUsage} />
			<TerminalComposer
				disabled={!canSend}
				onSend={sendInput}
				sending={sending}
				skills={sessionReady?.skills}
				slashCommands={sessionReady?.slashCommands}
			/>
		</div>
	);
}
