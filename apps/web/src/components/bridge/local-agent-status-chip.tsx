import { Badge } from "@better-agent/ui/components/badge";
import { cn } from "@better-agent/ui/lib/utils";
import type { LocalAgentStatus } from "./local-agent-status";

const STATUS_COPY: Record<LocalAgentStatus, string> = {
	live: "Live",
	idle: "Idle",
	ended: "Ended",
};

const STATUS_DOT_CLASS: Record<LocalAgentStatus, string> = {
	live: "bg-emerald-500",
	idle: "animate-pulse bg-amber-500",
	ended: "bg-muted-foreground/50",
};

/** Small live/idle/ended pill, shared by the local-agent list cards and the
 * detail page header. */
export function LocalAgentStatusChip({ status }: { status: LocalAgentStatus }) {
	const dotClassName = STATUS_DOT_CLASS[status];

	return (
		<Badge
			className="gap-1.5"
			variant={status === "ended" ? "secondary" : "outline"}
		>
			<span aria-hidden className={cn("size-1.5 rounded-full", dotClassName)} />
			{STATUS_COPY[status]}
		</Badge>
	);
}
