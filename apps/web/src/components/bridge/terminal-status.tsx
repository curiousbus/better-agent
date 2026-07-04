import { cn } from "@better-agent/ui/lib/utils";
import type { ConnectionStatus } from "./terminal-connection";

const STATUS_COPY: Record<ConnectionStatus, string> = {
	live: "Live",
	connecting: "Connecting…",
	polling: "Degraded (polling)",
};

const STATUS_DOT_CLASS: Record<ConnectionStatus, string> = {
	live: "bg-emerald-500",
	connecting: "bg-amber-500 animate-pulse",
	polling: "bg-orange-500",
};

/** Small connection-status pill for the terminal header. */
export function TerminalStatus({ status }: { status: ConnectionStatus }) {
	const dotClass = STATUS_DOT_CLASS[status];
	return (
		<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
			<span aria-hidden className={cn("size-1.5 rounded-full", dotClass)} />
			{STATUS_COPY[status]}
		</span>
	);
}
