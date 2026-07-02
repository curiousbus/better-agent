import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { WrenchIcon } from "lucide-react";

import { orpc } from "@/utils/orpc";

const SKELETON_ROWS = ["t1", "t2", "t3"] as const;

function ToolList({ agentId }: { agentId: string }) {
	const tools = useQuery(
		orpc.agents.tools.queryOptions({ input: { id: agentId } })
	);
	if (tools.isPending) {
		return (
			<div className="flex flex-col gap-1.5">
				{SKELETON_ROWS.map((key) => (
					<Skeleton className="h-4 w-3/4" key={key} />
				))}
			</div>
		);
	}
	if (tools.error) {
		return <p className="text-destructive text-xs">{tools.error.message}</p>;
	}
	const rows = tools.data ?? [];
	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground text-xs">
				No tools configured. Link a Composio account or enable built-in tools in
				the agent's settings.
			</p>
		);
	}
	return (
		<div className="flex max-h-64 flex-wrap content-start gap-1 overflow-y-auto">
			{rows.map((tool) => (
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
	);
}

/** Composer control: shows the tools this agent carries right now. */
export function AgentToolsPopover({ agentId }: { agentId: string }) {
	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button
						aria-label="Agent tools"
						size="icon-sm"
						title="Agent tools"
						type="button"
						variant="ghost"
					/>
				}
			>
				<WrenchIcon className="size-4" />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-96">
				<PopoverTitle className="mb-2 text-sm">Agent tools</PopoverTitle>
				<ToolList agentId={agentId} />
			</PopoverContent>
		</Popover>
	);
}
