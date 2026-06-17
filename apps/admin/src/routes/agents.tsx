import { createFileRoute } from "@tanstack/react-router";

import { AgentsCard } from "@/components/agents/agents-card";

export const Route = createFileRoute("/agents")({
	component: AgentsPage,
});

function AgentsPage() {
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5">
			<div className="flex flex-col gap-1">
				<h1 className="font-bold text-2xl">Agents</h1>
				<p className="text-muted-foreground text-sm">
					Configure agents with a provider, model, and system prompt.
				</p>
			</div>
			<AgentsCard />
		</div>
	);
}
