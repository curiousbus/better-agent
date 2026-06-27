import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { ConnectionsSection } from "@/components/composio/connections-section";
import { ToolkitsSection } from "@/components/composio/toolkits-section";

export const Route = createFileRoute("/composio/$accountId")({
	component: AccountDetailPage,
});

function AccountDetailPage() {
	const { accountId } = Route.useParams();

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto p-6">
			<Link
				className="flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				to="/composio"
			>
				<ArrowLeftIcon className="size-4" />
				Composio accounts
			</Link>
			<ConnectionsSection accountId={accountId} />
			<ToolkitsSection accountId={accountId} />
		</div>
	);
}
