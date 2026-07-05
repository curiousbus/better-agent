import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@better-agent/ui/components/message-scroller";
import type { BridgeSessionRow } from "@/utils/api-types";
import type { StreamEvent } from "./bridge-events";
import type { BridgeTransport } from "./bridge-transport";
import { EventLine } from "./event-line";
import { TerminalComposer } from "./terminal-composer";
import { TerminalStatus } from "./terminal-status";
import { useBridgeTerminal } from "./use-bridge-terminal";

function EmptyTerminal() {
	return (
		<p className="p-4 text-muted-foreground text-sm">
			No output yet — waiting for the agent…
		</p>
	);
}

interface TerminalFeedProps {
	answerApproval: (requestId: string, optionId: string) => Promise<void>;
	answered: Record<string, string>;
	events: StreamEvent[];
	sending: boolean;
}

/** The scrolling event list: one `EventLine` per entry, or the empty state. */
function TerminalFeed({
	answerApproval,
	answered,
	events,
	sending,
}: TerminalFeedProps) {
	return (
		<MessageScrollerProvider autoScroll defaultScrollPosition="end">
			<MessageScroller>
				<MessageScrollerViewport>
					<MessageScrollerContent className="flex flex-col gap-1.5 px-3 py-3 font-mono text-xs">
						{events.length === 0 ? (
							<EmptyTerminal />
						) : (
							events.map((entry) => (
								<MessageScrollerItem key={entry.id}>
									<EventLine
										answeredApprovals={answered}
										approvalPending={sending}
										event={entry.event}
										onAnswerApproval={answerApproval}
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
}

/**
 * Live view of one bridge session: header shows connection status, body is
 * the auto-scrolling, ordered/deduped normalized-event feed, footer is the
 * input box that posts via `sendInput`. `transport` is always injected
 * (real one from bridge-transport.ts in the route, a fake in tests) —
 * mirrors `Conversation`'s injected `AgentClient`.
 */
export function Terminal({ session, transport }: TerminalProps) {
	const {
		events,
		status,
		canSend,
		sending,
		sendInput,
		answered,
		answerApproval,
	} = useBridgeTerminal(session.id, transport);

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
				events={events}
				sending={sending}
			/>
			<div className="border-t p-2">
				<TerminalComposer
					disabled={!canSend}
					onSend={sendInput}
					sending={sending}
				/>
			</div>
		</div>
	);
}
