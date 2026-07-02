import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { AccountDetail } from "@/components/integrations/account-detail";

export const Route = createFileRoute("/integrations/$accountId")({
	component: AccountDetailPage,
});

function AccountDetailPage() {
	const { accountId } = Route.useParams();

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto p-6">
			<Link
				className="flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				to="/integrations"
			>
				<ArrowLeftIcon className="size-4" />
				Integrations
			</Link>
			<AccountDetail accountId={accountId} />
		</div>
	);
}
