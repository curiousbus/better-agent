import type { ChatAvatars } from "@better-agent/ui/components/chat/chat-row";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@better-agent/ui/components/message-scroller";
import { cn } from "@better-agent/ui/lib/utils";
import { BridgeChatRow } from "./bridge-chat-row";
import type { BridgeTurn } from "./bridge-turns";

// The scrolling conversation surface for a Local Agent session, split out of
// terminal.tsx to keep that file under the repo's max-lines-per-file gate: the
// turn list plus the persistent "working" row (see `WorkingSkeleton`).

/** The shimmer lines' widths (varying, so the placeholder reads as prose rather
 * than a progress bar) — static Tailwind classes so the sweep animation (see
 * `.working-shimmer` in index.css) has real blocks to move across. */
const SHIMMER_LINE_WIDTHS = ["w-4/5", "w-3/5", "w-2/5"] as const;

function EmptyTerminal() {
	return (
		<div className="flex flex-1 items-center justify-center py-24 text-center">
			<p className="text-muted-foreground text-sm">
				No output yet — waiting for the agent…
			</p>
		</div>
	);
}

/** A persistent assistant-message-shaped placeholder — an avatar dot plus a few
 * shimmering lines — pinned to the bottom of the feed for the WHOLE in-flight
 * turn (from the user's send until `turn_usage`/`turn_end`). The moving
 * highlight sweep (`.working-shimmer`, index.css) makes it obvious the agent is
 * still producing, so a long tool run never looks frozen; it replaces the old
 * "Thinking…/Working…" text line. Respects `prefers-reduced-motion` (the sweep
 * becomes a gentle opacity pulse). */
function WorkingSkeleton() {
	return (
		<div
			aria-label="Agent is working"
			className="flex gap-3 px-1 py-3"
			data-testid="working-skeleton"
			role="status"
		>
			<div className="working-shimmer size-7 shrink-0 rounded-full" />
			<div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
				{SHIMMER_LINE_WIDTHS.map((width) => (
					<div
						className={cn("working-shimmer h-3 rounded", width)}
						key={width}
					/>
				))}
			</div>
		</div>
	);
}

export interface TerminalFeedProps {
	answerApproval: (requestId: string, optionId: string) => Promise<void>;
	answered: Record<string, string>;
	avatars: ChatAvatars;
	ended: boolean;
	sending: boolean;
	/** True for the entire in-flight turn — keeps the working skeleton visible
	 * throughout, not just before the first token. */
	turnInFlight: boolean;
	turns: BridgeTurn[];
}

/** The scrolling conversation: bridge turns rendered as chat bubbles/lines. */
export function TerminalFeed({
	answerApproval,
	answered,
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
						{turnInFlight && <WorkingSkeleton />}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}
