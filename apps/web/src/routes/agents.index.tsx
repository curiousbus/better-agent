import { createFileRoute } from "@tanstack/react-router";

import { AgentsCard } from "@/components/agents/agents-card";

export const Route = createFileRoute("/agents/")({
	component: AgentsPage,
});

function AgentsPage() {
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 overflow-auto p-4 sm:p-6">
			<AgentsCard />
		</div>
	);
}
