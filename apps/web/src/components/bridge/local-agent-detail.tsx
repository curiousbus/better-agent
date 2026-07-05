import { Button } from "@better-agent/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import type { BridgeSessionRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { createBridgeTransport } from "./bridge-transport";
import { LocalAgentDetailSkeleton } from "./local-agent-detail-skeleton";
import { formatSessionTimestamp } from "./local-agent-format";
import { AgentKindIcon } from "./local-agent-kind-icon";
import { withSessionPolling } from "./local-agent-poll";
import { deriveLocalAgentStatus } from "./local-agent-status";
import { LocalAgentStatusChip } from "./local-agent-status-chip";
import { Terminal } from "./terminal";

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

function DetailHeader({
	session,
	ending,
	onEnd,
}: {
	session: BridgeSessionRow;
	ending: boolean;
	onEnd: () => void;
}) {
	const status = deriveLocalAgentStatus(session);
	return (
		<div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
			<div className="flex min-w-0 items-start gap-2">
				<AgentKindIcon
					className="mt-0.5 size-4 shrink-0 text-muted-foreground"
					kind={session.agentKind}
				/>
				<div className="min-w-0">
					<p className="truncate font-medium text-sm">
						{session.label ?? session.agentKind}
					</p>
					<p className="text-muted-foreground text-xs">{session.agentKind}</p>
					<p className="text-muted-foreground text-xs">
						Started {formatSessionTimestamp(session.createdAt)} · last seen{" "}
						{formatSessionTimestamp(session.lastSeenAt)}
					</p>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<LocalAgentStatusChip status={status} />
				{status === "ended" ? null : (
					<Button disabled={ending} onClick={onEnd} size="xs" variant="outline">
						End session
					</Button>
				)}
			</div>
		</div>
	);
}

/**
 * The `/local-agents/$sessionId` body: status header + the live terminal +
 * an End-session action, or a friendly not-found state if `sessionId` isn't
 * one of the user's sessions (foreign id, typo, already-deleted row). Finds
 * the session in the same `listSessions` query the list page uses — no
 * dedicated get-by-id endpoint exists, and this keeps both pages sharing one
 * cache entry.
 */
export function LocalAgentDetail({ sessionId }: { sessionId: string }) {
	const sessions = useQuery(
		withSessionPolling(orpc.bridge.listSessions.queryOptions())
	);
	const endSession = useEndSession();
	const transport = useMemo(() => createBridgeTransport(), []);

	if (sessions.isPending) {
		return <LocalAgentDetailSkeleton />;
	}

	const session = (sessions.data ?? []).find((row) => row.id === sessionId);

	if (!session) {
		return (
			<p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
				This local agent session wasn't found — it may have been ended and
				removed, or the link is wrong.
			</p>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<DetailHeader
				ending={endSession.isPending}
				onEnd={() => endSession.mutate({ sessionId })}
				session={session}
			/>
			<Terminal session={session} transport={transport} />
		</div>
	);
}
