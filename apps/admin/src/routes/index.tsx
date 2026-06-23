import { buttonVariants } from "@better-agent/ui/components/button";
import { cn } from "@better-agent/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Bot, PlusIcon } from "lucide-react";

import type { AgentRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/")({
	component: HomePage,
});

function AgentCard({ agent }: { agent: AgentRow }) {
	return (
		<Link
			className="flex items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted"
			params={{ agentId: agent.id }}
			to="/agents/$agentId"
		>
			<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
				<Bot className="size-4" />
			</div>
			<div className="min-w-0">
				<div className="truncate font-medium text-sm">{agent.name}</div>
				<div className="truncate text-muted-foreground text-xs">
					{agent.providerId}/{agent.modelId}
				</div>
			</div>
		</Link>
	);
}

function HomePage() {
	const agents = useQuery(orpc.agents.list.queryOptions());
	const rows = agents.data ?? [];
	return (
		<div className="flex flex-1 flex-col items-center justify-center overflow-auto p-6">
			<div className="w-full max-w-2xl">
				<h1 className="font-semibold text-3xl tracking-tight">
					Hello there 👋
				</h1>
				<p className="mt-1 text-lg text-muted-foreground">
					Pick an agent to start chatting.
				</p>
				<div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
					{rows.map((agent) => (
						<AgentCard agent={agent} key={agent.id} />
					))}
				</div>
				{!agents.isLoading && rows.length === 0 ? (
					<div className="mt-6 rounded-xl border border-dashed p-6 text-center">
						<p className="text-muted-foreground text-sm">
							No agents yet. Create one to start chatting.
						</p>
						<Link
							className={cn(
								buttonVariants({ variant: "default", size: "default" }),
								"mt-3 gap-2"
							)}
							to="/agents"
						>
							<PlusIcon className="size-4" />
							Create an agent
						</Link>
					</div>
				) : null}
			</div>
		</div>
	);
}
