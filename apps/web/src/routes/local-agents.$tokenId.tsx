import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { LocalAgentDetail } from "@/components/bridge/local-agent-detail";

export const Route = createFileRoute("/local-agents/$tokenId")({
	component: LocalAgentDetailPage,
});

function LocalAgentDetailPage() {
	const { tokenId } = Route.useParams();

	return (
		<div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
			<Link
				className="flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				to="/local-agents"
			>
				<ArrowLeftIcon className="size-4" />
				Local agents
			</Link>
			<LocalAgentDetail tokenId={tokenId} />
		</div>
	);
}
