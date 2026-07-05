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
import { type AgentCapabilities, capabilities } from "./agent-capabilities";
import { BridgeChatRow } from "./bridge-chat-row";
import type {
	SessionListDetail,
	SessionReadyDetail,
	TurnUsageDetail,
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
	caps: AgentCapabilities;
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
 * session controls (Interrupt/model/permission mode/past conversations) —
 * each gated on `caps` (see agent-capabilities.ts) so a session only shows
 * the controls its running agent actually supports. Split out of `Terminal`
 * purely to keep that component under the repo's max-lines-per-function
 * gate. */
function TerminalHeader({
	caps,
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
					{caps.sessionList && (
						<PastConversations
							disabled={!canSend}
							onRequestList={listSessions}
							sessionList={sessionList}
						/>
					)}
					<TerminalControls
						disabled={!canSend}
						model={sessionReady?.model}
						onInterrupt={interrupt}
						onSetModel={setModel}
						onSetPermissionMode={setPermissionMode}
						permissionMode={sessionReady?.permissionMode}
						permissionModes={caps.permissionModes}
						showInterrupt={caps.interrupt}
						showModelPicker={caps.modelSwitch}
					/>
				</div>
			</div>
		</div>
	);
}

interface TerminalBodyProps {
	answerApproval: (requestId: string, optionId: string) => Promise<void>;
	answered: Record<string, string>;
	avatars: ChatAvatars;
	caps: AgentCapabilities;
	disabled: boolean;
	ended: boolean;
	onSend: (text: string) => Promise<void>;
	sending: boolean;
	sessionReady: SessionReadyDetail | null;
	turns: BridgeTurn[];
	turnUsage: TurnUsageDetail | null;
}

/** The feed, the (capability-gated) usage chip, and the composer — split out
 * of `Terminal` purely to keep that component under the repo's
 * max-lines-per-function gate. */
function TerminalBody({
	answerApproval,
	answered,
	avatars,
	caps,
	disabled,
	ended,
	onSend,
	sending,
	sessionReady,
	turns,
	turnUsage,
}: TerminalBodyProps) {
	return (
		<>
			<TerminalFeed
				answerApproval={answerApproval}
				answered={answered}
				avatars={avatars}
				ended={ended}
				sending={sending}
				turns={turns}
			/>
			{caps.usageMode === "stream" && <TurnUsageChip detail={turnUsage} />}
			<TerminalComposer
				disabled={disabled}
				onSend={onSend}
				sending={sending}
				skills={caps.skills ? sessionReady?.skills : undefined}
				slashCommands={
					caps.slashCommands ? sessionReady?.slashCommands : undefined
				}
			/>
		</>
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
	const caps = capabilities(session.agentKind);

	return (
		<div className="flex min-h-0 flex-1 flex-col rounded-lg border">
			<TerminalHeader
				canSend={canSend}
				caps={caps}
				interrupt={interrupt}
				label={session.label ?? session.agentKind}
				listSessions={listSessions}
				sessionList={sessionList}
				sessionReady={sessionReady}
				setModel={setModel}
				setPermissionMode={setPermissionMode}
				status={status}
			/>
			<TerminalBody
				answerApproval={answerApproval}
				answered={answered}
				avatars={avatars}
				caps={caps}
				disabled={!canSend}
				ended={status === "ended"}
				onSend={sendInput}
				sending={sending}
				sessionReady={sessionReady}
				turns={turns}
				turnUsage={turnUsage}
			/>
		</div>
	);
}
