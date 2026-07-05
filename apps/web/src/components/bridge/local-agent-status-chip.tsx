import { Badge } from "@better-agent/ui/components/badge";
import { cn } from "@better-agent/ui/lib/utils";
import type { LocalAgentEntryStatus } from "./local-agent-join";

const STATUS_COPY: Record<LocalAgentEntryStatus, string> = {
	live: "Live",
	idle: "Idle",
	ended: "Ended",
	"not-connected": "Not connected",
};

const STATUS_DOT_CLASS: Record<LocalAgentEntryStatus, string> = {
	live: "bg-emerald-500",
	idle: "animate-pulse bg-amber-500",
	ended: "bg-muted-foreground/50",
	"not-connected": "bg-muted-foreground/30",
};

/** Small live/idle/ended/not-connected pill, shared by the local-agent list
 * cards and the detail page header. */
export function LocalAgentStatusChip({
	status,
}: {
	status: LocalAgentEntryStatus;
}) {
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
