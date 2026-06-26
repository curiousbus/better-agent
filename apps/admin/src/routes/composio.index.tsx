import { createFileRoute } from "@tanstack/react-router";

import { AccountsTable } from "@/components/composio/accounts-table";
import { AddAccountDialog } from "@/components/composio/add-account-dialog";

export const Route = createFileRoute("/composio/")({
	component: ComposioPage,
});

function ComposioPage() {
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-semibold text-lg">Composio accounts</h1>
					<p className="text-muted-foreground text-sm">
						Add a composio API key, then open an account to authenticate
						toolkits. Agents integrate every authenticated toolkit of the
						accounts they link.
					</p>
				</div>
				<AddAccountDialog />
			</div>
			<AccountsTable />
		</div>
	);
}
