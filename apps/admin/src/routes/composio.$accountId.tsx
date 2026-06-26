import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { ConnectionsSection } from "@/components/composio/connections-section";
import { ToolkitsSection } from "@/components/composio/toolkits-section";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/composio/$accountId")({
	component: AccountDetailPage,
});

function AccountDetailPage() {
	const { accountId } = Route.useParams();
	const accounts = useQuery(orpc.composio.listAccounts.queryOptions());
	const account = accounts.data?.find((row) => row.id === accountId);

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto p-6">
			<Link
				className="flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				to="/composio"
			>
				<ArrowLeftIcon className="size-4" />
				Composio accounts
			</Link>
			<div>
				<h1 className="font-semibold text-lg">
					{account?.name ?? "Composio account"}
				</h1>
				<p className="text-muted-foreground text-sm">
					Authenticate toolkits for this account. Agents linked to it integrate
					every authenticated toolkit.
				</p>
			</div>
			<ConnectionsSection accountId={accountId} />
			<ToolkitsSection accountId={accountId} />
		</div>
	);
}
