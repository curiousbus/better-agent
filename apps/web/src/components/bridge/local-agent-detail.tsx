import { CopyAction } from "@better-agent/ui/components/actions";
import { Button } from "@better-agent/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import type { BridgeSessionRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { bridgeCliCommand } from "./bridge-token-reveal-dialog";
import { createBridgeTransport } from "./bridge-transport";
import { LocalAgentDetailSkeleton } from "./local-agent-detail-skeleton";
import {
	formatSessionTimestamp,
	localAgentDisplayName,
} from "./local-agent-format";
import { deriveLocalAgentEntries } from "./local-agent-join";
import { AgentKindIcon } from "./local-agent-kind-icon";
import { withSessionPolling } from "./local-agent-poll";
import { deriveLocalAgentStatus } from "./local-agent-status";
import { LocalAgentStatusChip } from "./local-agent-status-chip";
import { Terminal } from "./terminal";

// The raw token is only shown once at creation and never stored, so the
// waiting-state command is a copy-paste template, not a live secret.
const PLACEHOLDER_TOKEN = "<your-bridge-token>";

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
	name,
	session,
	ending,
	onEnd,
}: {
	name: string;
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
					<p className="truncate font-medium text-sm">{name}</p>
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

/** Friendly state for a token whose CLI has never connected: the ready-to-run
 * command (with a placeholder token) instead of a terminal for a session that
 * doesn't exist yet. */
function WaitingForCli() {
	const command = bridgeCliCommand(PLACEHOLDER_TOKEN);
	return (
		<div className="flex flex-col gap-3 rounded-lg border border-dashed p-6">
			<div>
				<p className="font-medium text-sm">Waiting for the CLI to connect</p>
				<p className="text-muted-foreground text-sm">
					Run this from your project directory (with your bridge token) to
					connect this local agent.
				</p>
			</div>
			<div className="flex items-center gap-1.5">
				<code className="block w-full overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-2 py-1.5 font-mono text-xs">
					{command}
				</code>
				<CopyAction label="Copy command" text={command} />
			</div>
		</div>
	);
}

function NotFound() {
	return (
		<p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
			This local agent wasn't found — it may have been removed, or the link is
			wrong.
		</p>
	);
}

/**
 * The `/local-agents/$tokenId` body. One bridge token = one persistent local
 * agent; the view always follows that token's LATEST session. Joins the same
 * `listTokens` + `listSessions` queries the list page polls (shared cache),
 * then:
 *  - unknown/revoked token → not-found;
 *  - token with no session yet → waiting-for-CLI;
 *  - token with a session → header + `Terminal`, keyed by the session id so a
 *    newer session (the CLI relaunched) remounts the terminal onto it instead
 *    of polling the old, now-dead one — the whole "clicking into a dead
 *    session" fix.
 */
export function LocalAgentDetail({ tokenId }: { tokenId: string }) {
	const tokens = useQuery(orpc.bridge.listTokens.queryOptions());
	const sessions = useQuery(
		withSessionPolling(orpc.bridge.listSessions.queryOptions())
	);
	const endSession = useEndSession();
	const transport = useMemo(() => createBridgeTransport(), []);

	if (tokens.isPending || sessions.isPending) {
		return <LocalAgentDetailSkeleton />;
	}

	const entries = deriveLocalAgentEntries(
		tokens.data ?? [],
		sessions.data ?? []
	);
	const entry = entries.find((candidate) => candidate.token.id === tokenId);

	if (!entry) {
		return <NotFound />;
	}

	const session = entry.latestSession;
	if (!session) {
		return (
			<div className="flex min-h-0 flex-1 flex-col gap-3">
				<WaitingForCli />
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<DetailHeader
				ending={endSession.isPending}
				name={localAgentDisplayName(entry)}
				onEnd={() => endSession.mutate({ sessionId: session.id })}
				session={session}
			/>
			<Terminal key={session.id} session={session} transport={transport} />
		</div>
	);
}
