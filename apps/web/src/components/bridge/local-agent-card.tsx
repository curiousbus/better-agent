import { Card, CardContent } from "@better-agent/ui/components/card";
import { Link } from "@tanstack/react-router";
import type { BridgeSessionRow } from "@/utils/api-types";
import { deriveLocalAgentStatus } from "./local-agent-status";
import { LocalAgentStatusChip } from "./local-agent-status-chip";

function formatLastSeen(value: Date): string {
	return new Date(value).toLocaleString();
}

/** One local-agent session as a card: label/kind + last-seen on the left,
 * status chip on the right. The whole card links to the detail page. */
export function LocalAgentCard({ session }: { session: BridgeSessionRow }) {
	const status = deriveLocalAgentStatus(session);
	return (
		<Link
			className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
			params={{ sessionId: session.id }}
			to="/local-agents/$sessionId"
		>
			<Card className="transition-colors hover:bg-muted/50">
				<CardContent className="flex items-center justify-between gap-3">
					<div className="min-w-0 flex-1">
						<p className="truncate font-medium text-sm">
							{session.label ?? session.agentKind}
						</p>
						<p className="truncate text-muted-foreground text-xs">
							{session.agentKind} · last seen{" "}
							{formatLastSeen(session.lastSeenAt)}
						</p>
					</div>
					<LocalAgentStatusChip status={status} />
				</CardContent>
			</Card>
		</Link>
	);
}
