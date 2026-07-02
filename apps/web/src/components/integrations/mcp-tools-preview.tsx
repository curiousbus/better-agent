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

const SKELETON_ROWS = ["s1", "s2", "s3"] as const;

function ToolsSkeleton() {
	return (
		<div className="flex flex-col gap-2">
			{SKELETON_ROWS.map((key) => (
				<Skeleton className="h-5 w-full" key={key} />
			))}
		</div>
	);
}

function ToolsBody({ serverId }: { serverId: string }) {
	const tools = useQuery(orpc.mcp.tools.queryOptions({ input: { serverId } }));

	if (tools.isPending) {
		return <ToolsSkeleton />;
	}
	if (tools.error) {
		return <p className="text-destructive text-xs">{tools.error.message}</p>;
	}
	if (tools.data.length === 0) {
		return <p className="text-muted-foreground text-xs">No tools reported.</p>;
	}
	return (
		<div className="flex flex-wrap gap-1.5">
			{tools.data.map((tool) => (
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

/** Live tool list for one MCP server — shows exactly what the server offers right now. */
export function McpToolsPreview({
	serverId,
	serverName,
}: {
	serverId: string;
	serverName: string;
}) {
	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button
						aria-label={`Preview tools for ${serverName}`}
						size="icon-xs"
						title="Preview tools"
						variant="ghost"
					/>
				}
			>
				<WrenchIcon className="size-4" />
			</PopoverTrigger>
			<PopoverContent className="w-80">
				<PopoverTitle className="text-sm">{`${serverName} tools`}</PopoverTitle>
				<ToolsBody serverId={serverId} />
			</PopoverContent>
		</Popover>
	);
}
