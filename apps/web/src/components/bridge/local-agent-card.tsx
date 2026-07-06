import { Card, CardContent } from "@better-agent/ui/components/card";
import { Link } from "@tanstack/react-router";
import {
	formatSessionTimestamp,
	localAgentDisplayName,
} from "./local-agent-format";
import type { LocalAgentEntry } from "./local-agent-join";
import { AGENT_KIND_LABEL, AgentKindIcon } from "./local-agent-kind-icon";
import { LocalAgentStatusChip } from "./local-agent-status-chip";

const ICON_CLASS = "size-4 shrink-0 text-muted-foreground";

/** One local agent (bridge token) as a card: name + its bound agent kind and
 * last-seen on the left, status chip on the right. The whole card links to the
 * token's detail page, which always follows that token's latest session. */
export function LocalAgentCard({ entry }: { entry: LocalAgentEntry }) {
	const { latestSession, status, token } = entry;
	const kindLabel = AGENT_KIND_LABEL[token.agentKind];
	return (
		<Link
			className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
			params={{ tokenId: token.id }}
			to="/local-agents/$tokenId"
		>
			<Card className="transition-colors hover:bg-muted/50">
				<CardContent className="flex items-center justify-between gap-3">
					<AgentKindIcon className={ICON_CLASS} kind={token.agentKind} />
					<div className="min-w-0 flex-1">
						<p className="truncate font-medium text-sm">
							{localAgentDisplayName(entry)}
						</p>
						<p className="truncate text-muted-foreground text-xs">
							{latestSession
								? `${kindLabel} · last seen ${formatSessionTimestamp(latestSession.lastSeenAt)}`
								: `${kindLabel} · not connected yet`}
						</p>
					</div>
					<LocalAgentStatusChip status={status} />
				</CardContent>
			</Card>
		</Link>
	);
}
