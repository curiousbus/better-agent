import { createFileRoute } from "@tanstack/react-router";

import { AddLocalAgentDialog } from "@/components/bridge/add-local-agent-dialog";
import { LocalAgentList } from "@/components/bridge/local-agent-list";

export const Route = createFileRoute("/local-agents/")({
	component: LocalAgentsPage,
});

function LocalAgentsPage() {
	return (
		<div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 p-4 sm:p-6">
			<div className="flex items-center justify-end">
				<AddLocalAgentDialog />
			</div>
			<LocalAgentList />
		</div>
	);
}
