import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import { LocalAgentCard } from "./local-agent-card";
import { LocalAgentListSkeleton } from "./local-agent-list-skeleton";
import { withSessionPolling } from "./local-agent-poll";

/** Polls the user's bridge sessions and renders them as cards linking to
 * each session's detail page. */
export function LocalAgentList() {
	const sessions = useQuery(
		withSessionPolling(orpc.bridge.listSessions.queryOptions())
	);

	if (sessions.isPending) {
		return <LocalAgentListSkeleton />;
	}

	const rows = sessions.data ?? [];
	if (rows.length === 0) {
		return (
			<p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
				No local agents yet — add one to start streaming a session here.
			</p>
		);
	}

	return (
		<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
			{rows.map((row) => (
				<LocalAgentCard key={row.id} session={row} />
			))}
		</div>
	);
}
