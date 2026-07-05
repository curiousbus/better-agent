import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import { LocalAgentCard } from "./local-agent-card";
import { deriveLocalAgentEntries } from "./local-agent-join";
import { LocalAgentListSkeleton } from "./local-agent-list-skeleton";
import { withSessionPolling } from "./local-agent-poll";

/** Polls the user's bridge tokens + sessions and renders one card per token —
 * a persistent "local agent" that follows its token's latest session, so
 * relaunching the CLI never piles up dead cards. */
export function LocalAgentList() {
	const tokens = useQuery(orpc.bridge.listTokens.queryOptions());
	const sessions = useQuery(
		withSessionPolling(orpc.bridge.listSessions.queryOptions())
	);

	if (tokens.isPending || sessions.isPending) {
		return <LocalAgentListSkeleton />;
	}

	const entries = deriveLocalAgentEntries(
		tokens.data ?? [],
		sessions.data ?? []
	);
	if (entries.length === 0) {
		return (
			<p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
				No local agents yet — add one to start streaming a session here.
			</p>
		);
	}

	return (
		<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
			{entries.map((entry) => (
				<LocalAgentCard entry={entry} key={entry.token.id} />
			))}
		</div>
	);
}
