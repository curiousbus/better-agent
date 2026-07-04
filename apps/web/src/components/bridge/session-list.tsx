import { Button } from "@better-agent/ui/components/button";
import { cn } from "@better-agent/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { BridgeSessionRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { SessionListSkeleton } from "./session-list-skeleton";

const SESSION_POLL_INTERVAL_MS = 5000;

function formatLastSeen(value: Date): string {
	return new Date(value).toLocaleTimeString();
}

function SessionRow({
	row,
	selected,
	onSelect,
	onEnd,
}: {
	row: BridgeSessionRow;
	selected: boolean;
	onSelect: (id: string) => void;
	onEnd: (id: string) => void;
}) {
	return (
		<div
			className={cn(
				"flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
				selected ? "bg-primary/10" : "hover:bg-muted"
			)}
		>
			<button
				className="flex min-w-0 flex-1 flex-col items-start text-left"
				onClick={() => onSelect(row.id)}
				type="button"
			>
				<span className="truncate font-medium">
					{row.label ?? row.agentKind}
				</span>
				<span className="text-muted-foreground text-xs">
					{row.agentKind} · last seen {formatLastSeen(row.lastSeenAt)}
				</span>
			</button>
			{row.status === "active" ? (
				<Button onClick={() => onEnd(row.id)} size="xs" variant="outline">
					End
				</Button>
			) : (
				<span className="text-muted-foreground text-xs">Ended</span>
			)}
		</div>
	);
}

function useEndSession() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.bridge.endSession.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.bridge.listSessions.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

export interface SessionListProps {
	onSelect: (id: string) => void;
	selectedId: string | null;
}

/** Polls the user's bridge sessions and lets them pick one to view, or end it. */
export function SessionList({ selectedId, onSelect }: SessionListProps) {
	const sessions = useQuery({
		...orpc.bridge.listSessions.queryOptions(),
		refetchInterval: SESSION_POLL_INTERVAL_MS,
	});
	const endSession = useEndSession();

	if (sessions.isPending) {
		return <SessionListSkeleton />;
	}

	const rows = sessions.data ?? [];
	if (rows.length === 0) {
		return (
			<p className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
				No bridge sessions yet — start one from a terminal with the
				better-agent-bridge CLI.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-1">
			{rows.map((row) => (
				<SessionRow
					key={row.id}
					onEnd={(id) => endSession.mutate({ sessionId: id })}
					onSelect={onSelect}
					row={row}
					selected={row.id === selectedId}
				/>
			))}
		</div>
	);
}
