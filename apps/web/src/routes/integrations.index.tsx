import { createFileRoute } from "@tanstack/react-router";

import { AccountsList } from "@/components/integrations/accounts-list";
import { McpServersSection } from "@/components/integrations/mcp-servers-section";

export const Route = createFileRoute("/integrations/")({
	component: IntegrationsPage,
});

function IntegrationsPage() {
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 overflow-auto p-6">
			<AccountsList />
			<McpServersSection />
		</div>
	);
}
