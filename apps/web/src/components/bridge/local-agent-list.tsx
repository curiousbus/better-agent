import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { BridgeSessionRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { deriveLocalAgentEntries } from "./local-agent-join";
import { LocalAgentListSkeleton } from "./local-agent-list-skeleton";
import { withSessionPolling } from "./local-agent-poll";
import { LocalAgentTable, type LocalAgentTableRow } from "./local-agent-table";

function countSessionsByToken(
	sessions: BridgeSessionRow[]
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const session of sessions) {
		counts.set(session.tokenId, (counts.get(session.tokenId) ?? 0) + 1);
	}
	return counts;
}

function useDeleteAgent() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.bridge.deleteToken.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.bridge.listTokens.key(),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.bridge.listSessions.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

/** Polls the user's bridge tokens + sessions and renders one table row per
 * token — a persistent "local agent" that follows its token's latest session,
 * so relaunching the CLI never piles up dead rows. Each row links to the
 * agent's detail page and can be deleted from its Actions cell. */
export function LocalAgentList() {
	const tokens = useQuery(orpc.bridge.listTokens.queryOptions());
	const sessions = useQuery(
		withSessionPolling(orpc.bridge.listSessions.queryOptions())
	);
	const deleteAgent = useDeleteAgent();

	if (tokens.isPending || sessions.isPending) {
		return <LocalAgentListSkeleton />;
	}

	const sessionData = sessions.data ?? [];
	const counts = countSessionsByToken(sessionData);
	const entries = deriveLocalAgentEntries(tokens.data ?? [], sessionData);
	const rows: LocalAgentTableRow[] = entries.map((entry) => ({
		entry,
		sessionCount: counts.get(entry.token.id) ?? 0,
	}));

	return (
		<LocalAgentTable
			onDelete={(id) => deleteAgent.mutate({ id })}
			rows={rows}
		/>
	);
}
