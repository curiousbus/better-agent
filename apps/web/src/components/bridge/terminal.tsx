import type { ChatAvatars } from "@better-agent/ui/components/chat/chat-row";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@better-agent/ui/components/message-scroller";
import { Loader2Icon } from "lucide-react";
import { useMemo } from "react";
import type { BridgeSessionRow } from "@/utils/api-types";
import { agentAvatar } from "@/utils/avatar";
import { type AgentCapabilities, capabilities } from "./agent-capabilities";
import { BridgeChatRow } from "./bridge-chat-row";
import type {
	SessionReadyDetail,
	TurnUsageDetail,
} from "./bridge-session-status";
import type { BridgeTransport } from "./bridge-transport";
import { type BridgeTurn, foldEventsToTurns } from "./bridge-turns";
import { TerminalComposer } from "./terminal-composer";
import { TerminalHeader } from "./terminal-header";
import { TurnUsagePanel } from "./turn-usage-panel";
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

/** Shown after the user's turn while the agent hasn't produced any output yet —
 * claude's first token can be several seconds out, and without this the UI
 * looked frozen after sending. Clears itself the moment any output/reasoning
 * streams in (see `awaitingResponse` in useTerminalView). */
function ThinkingIndicator() {
	return (
		<div className="flex items-center gap-2 px-1 py-2 text-muted-foreground text-sm">
			<Loader2Icon className="size-4 animate-spin" />
			<span className="animate-pulse">Thinking…</span>
		</div>
	);
}

interface TerminalFeedProps {
	answerApproval: (requestId: string, optionId: string) => Promise<void>;
	answered: Record<string, string>;
	avatars: ChatAvatars;
	awaitingResponse: boolean;
	ended: boolean;
	sending: boolean;
	turns: BridgeTurn[];
}

/** The scrolling conversation: bridge turns rendered as chat bubbles/lines. */
function TerminalFeed({
	answerApproval,
	answered,
	avatars,
	awaitingResponse,
	ended,
	sending,
	turns,
}: TerminalFeedProps) {
	return (
		<MessageScrollerProvider autoScroll defaultScrollPosition="end">
			<MessageScroller>
				<MessageScrollerViewport>
					<MessageScrollerContent className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-4">
						{turns.length === 0 && !awaitingResponse ? (
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
						{awaitingResponse && <ThinkingIndicator />}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

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
	awaitingResponse: boolean;
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
	awaitingResponse,
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
				awaitingResponse={awaitingResponse}
				ended={ended}
				sending={sending}
				turns={turns}
			/>
			{caps.usageMode === "stream" && <TurnUsagePanel detail={turnUsage} />}
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
	// True after the user's turn until the agent produces ANY output/reasoning —
	// the "Thinking…" indicator's gate. Derived from the feed: if the most recent
	// message/output is the user's line, the agent hasn't started replying yet.
	const awaitingResponse = useMemo(() => {
		if (session.status === "ended") {
			return false;
		}
		for (let i = bridge.events.length - 1; i >= 0; i--) {
			const event = bridge.events[i].event;
			if (event.kind === "output") {
				return false;
			}
			if (event.kind === "message") {
				return event.role === "user";
			}
		}
		return false;
	}, [bridge.events, session.status]);
	const avatars: ChatAvatars = {
		assistant: agentAvatar(session.tokenId),
		user: userAvatarUrl,
	};
	return { ...bridge, turns, avatars, awaitingResponse };
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
				interrupt={view.interrupt}
				listSessions={view.listSessions}
				onEnd={onEnd}
				sessionId={sessionId}
				sessionList={view.sessionList}
				sessionReady={view.sessionReady}
				setModel={view.setModel}
				setPermissionMode={view.setPermissionMode}
				status={view.status}
			/>
			<TerminalBody
				answerApproval={view.answerApproval}
				answered={view.answered}
				avatars={view.avatars}
				awaitingResponse={view.awaitingResponse}
				caps={caps}
				disabled={!view.canSend}
				ended={view.status === "ended"}
				onSend={view.sendInput}
				sending={view.sending}
				sessionReady={view.sessionReady}
				turns={view.turns}
				turnUsage={view.turnUsage}
			/>
		</div>
	);
}
