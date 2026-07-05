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
import type { BridgeTransport } from "./bridge-transport";
import { type BridgeTurn, foldEventsToTurns } from "./bridge-turns";
import { TerminalComposer } from "./terminal-composer";
import { TerminalStatus } from "./terminal-status";
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

/**
 * Live view of one bridge session: header shows connection status, body is
 * the auto-scrolling, ordered/deduped normalized-event feed, footer is the
 * input box that posts via `sendInput`. `transport` is always injected
 * (real one from bridge-transport.ts in the route, a fake in tests) —
 * mirrors `Conversation`'s injected `AgentClient`.
 */
export function Terminal({ session, transport, userAvatarUrl }: TerminalProps) {
	const {
		events,
		status,
		canSend,
		sending,
		sendInput,
		answered,
		answerApproval,
	} = useBridgeTerminal(session.id, transport, session.status === "ended");
	const turns = useMemo(() => foldEventsToTurns(events), [events]);
	const avatars: ChatAvatars = {
		assistant: agentAvatar(session.tokenId),
		user: userAvatarUrl,
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col rounded-lg border">
			<div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
				<span className="font-medium text-sm">
					{session.label ?? session.agentKind}
				</span>
				<TerminalStatus status={status} />
			</div>
			<TerminalFeed
				answerApproval={answerApproval}
				answered={answered}
				avatars={avatars}
				ended={status === "ended"}
				sending={sending}
				turns={turns}
			/>
			<TerminalComposer
				disabled={!canSend}
				onSend={sendInput}
				sending={sending}
			/>
		</div>
	);
}
