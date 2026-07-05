import { cn } from "@better-agent/ui/lib/utils";
import type { ConnectionStatus } from "./terminal-connection";

/** `ConnectionStatus` plus the one state the connection reducer itself has no
 * concept of: the session has ended server-side, so the terminal shows this
 * instead of whatever transient SSE/poll status it was last in. */
export type TerminalConnectionStatus = ConnectionStatus | "ended";

const STATUS_COPY: Record<TerminalConnectionStatus, string> = {
	live: "Live",
	connecting: "Connecting…",
	polling: "Degraded (polling)",
	ended: "Ended",
};

const STATUS_DOT_CLASS: Record<TerminalConnectionStatus, string> = {
	live: "bg-emerald-500",
	connecting: "bg-amber-500 animate-pulse",
	polling: "bg-orange-500",
	ended: "bg-muted-foreground",
};

/** Small connection-status pill for the terminal header. */
export function TerminalStatus({
	status,
}: {
	status: TerminalConnectionStatus;
}) {
	const dotClass = STATUS_DOT_CLASS[status];
	return (
		<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
			<span aria-hidden className={cn("size-1.5 rounded-full", dotClass)} />
			{STATUS_COPY[status]}
		</span>
	);
}
