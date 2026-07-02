import { Badge } from "@better-agent/ui/components/badge";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

const PREVIEW_ROWS = ["t1", "t2", "t3"] as const;

function ToolsSkeleton() {
	return (
		<div className="flex flex-col gap-2">
			{PREVIEW_ROWS.map((key) => (
				<Skeleton className="h-5 w-2/3" key={key} />
			))}
		</div>
	);
}

/**
 * Shows exactly what a linked agent receives from this account right now —
 * the live tool-assembly pipeline. Empty or erroring here means the problem is
 * on the composio side; tools listed here but missing in chat means the agent
 * isn't linked to this account (edit the agent's Tools step).
 */
export function AgentToolsSection({ accountId }: { accountId: string }) {
	const tools = useQuery(
		orpc.composio.tools.queryOptions({ input: { accountId } })
	);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<h2 className="font-medium text-sm">Agent tools</h2>
				{tools.data ? (
					<Badge variant="secondary">{tools.data.tools.length}</Badge>
				) : null}
			</div>
			<p className="text-muted-foreground text-xs">
				What an agent linked to this account can call right now.
			</p>
			{tools.isPending ? <ToolsSkeleton /> : null}
			{tools.error ? (
				<p className="text-destructive text-sm">{tools.error.message}</p>
			) : null}
			{tools.data && tools.data.tools.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No tools yet — connect a toolkit below first.
				</p>
			) : null}
			{tools.data && tools.data.tools.length > 0 ? (
				<div className="flex flex-wrap gap-1.5">
					{tools.data.tools.map((tool) => (
						<Badge
							className="font-mono font-normal"
							key={tool.name}
							title={tool.description}
							variant="outline"
						>
							{tool.name}
						</Badge>
					))}
				</div>
			) : null}
		</div>
	);
}
