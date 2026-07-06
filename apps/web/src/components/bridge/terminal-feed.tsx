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
import { BridgeChatRow } from "./bridge-chat-row";
import type { BridgeTurn } from "./bridge-turns";

// The scrolling conversation surface for a Local Agent session, split out of
// terminal.tsx to keep that file under the repo's max-lines-per-file gate: the
// turn list plus the persistent "working" row (see `WorkingIndicator`).

function EmptyTerminal() {
	return (
		<div className="flex flex-1 items-center justify-center py-24 text-center">
			<p className="text-muted-foreground text-sm">
				No output yet — waiting for the agent…
			</p>
		</div>
	);
}

/** A persistent "the agent is working" row pinned to the bottom of the feed for
 * the WHOLE turn — from the user's send until the turn actually completes
 * (`turn_usage`/`turn_end`), NOT just until the first token. It previously
 * cleared on the first output, so a long tool run looked frozen. The label
 * still reads "Thinking…" during the pre-first-token wait, then "Working…" once
 * output is streaming, so both phases feel alive. */
function WorkingIndicator({ label }: { label: string }) {
	return (
		<div className="flex items-center gap-2 px-1 py-2 text-muted-foreground text-sm">
			<Loader2Icon className="size-4 animate-spin" />
			<span className="animate-pulse">{label}</span>
		</div>
	);
}

export interface TerminalFeedProps {
	answerApproval: (requestId: string, optionId: string) => Promise<void>;
	answered: Record<string, string>;
	avatars: ChatAvatars;
	/** True until the agent's first token of this turn — switches the working
	 * indicator's wording from "Thinking…" to "Working…". */
	awaitingFirstToken: boolean;
	ended: boolean;
	sending: boolean;
	/** True for the entire in-flight turn — keeps the working indicator visible
	 * throughout, not just before the first token. */
	turnInFlight: boolean;
	turns: BridgeTurn[];
}

/** The scrolling conversation: bridge turns rendered as chat bubbles/lines. */
export function TerminalFeed({
	answerApproval,
	answered,
	awaitingFirstToken,
	avatars,
	ended,
	sending,
	turnInFlight,
	turns,
}: TerminalFeedProps) {
	return (
		<MessageScrollerProvider autoScroll defaultScrollPosition="end">
			<MessageScroller>
				<MessageScrollerViewport>
					<MessageScrollerContent className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-4">
						{turns.length === 0 && !turnInFlight ? (
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
						{turnInFlight && (
							<WorkingIndicator
								label={awaitingFirstToken ? "Thinking…" : "Working…"}
							/>
						)}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}
