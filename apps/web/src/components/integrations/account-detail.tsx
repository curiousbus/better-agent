import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";
import { ConnectionsSection } from "./connections-section";
import { AccountDetailSkeleton } from "./integrations-skeleton";
import { ToolkitsSection } from "./toolkits-section";

export function AccountDetail({ accountId }: { accountId: string }) {
	const accounts = useQuery(orpc.composio.listAccounts.queryOptions());

	if (accounts.isPending) {
		return <AccountDetailSkeleton />;
	}

	const account = (accounts.data ?? []).find((row) => row.id === accountId);

	if (!account) {
		return (
			<p className="text-muted-foreground text-sm">
				This integration account was not found.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<h1 className="font-semibold text-lg">{account.name}</h1>
			<ConnectionsSection accountId={accountId} />
			<ToolkitsSection accountId={accountId} />
		</div>
	);
}
