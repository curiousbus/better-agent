import { createFileRoute } from "@tanstack/react-router";

import { AccountsTable } from "@/components/composio/accounts-table";
import { AddAccountDialog } from "@/components/composio/add-account-dialog";

export const Route = createFileRoute("/composio/")({
	component: ComposioPage,
});

function ComposioPage() {
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto p-6">
			<div className="flex justify-end">
				<AddAccountDialog />
			</div>
			<AccountsTable />
		</div>
	);
}
