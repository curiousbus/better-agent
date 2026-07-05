import { cn } from "@better-agent/ui/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";

import { AddLocalAgentDialog } from "@/components/bridge/add-local-agent-dialog";
import { LocalAgentList } from "@/components/bridge/local-agent-list";
import { TokenManager } from "@/components/bridge/token-manager";

type LocalAgentsTab = "sessions" | "tokens";

const DEFAULT_TAB: LocalAgentsTab = "sessions";

const TABS: ReadonlyArray<{ id: LocalAgentsTab; label: string }> = [
	{ id: "sessions", label: "Local agents" },
	{ id: "tokens", label: "Tokens" },
];

function isLocalAgentsTab(value: unknown): value is LocalAgentsTab {
	return value === "sessions" || value === "tokens";
}

export const Route = createFileRoute("/local-agents/")({
	component: LocalAgentsPage,
	validateSearch: (
		search: Record<string, unknown>
	): { tab?: LocalAgentsTab } => ({
		tab: isLocalAgentsTab(search.tab) ? search.tab : undefined,
	}),
});

function LocalAgentsTabLink({
	active,
	id,
	label,
}: {
	active: boolean;
	id: LocalAgentsTab;
	label: string;
}) {
	return (
		<Link
			className={cn(
				"rounded-md px-3 py-1.5 text-left text-sm transition-colors",
				active
					? "bg-primary/10 font-medium text-primary"
					: "text-muted-foreground hover:bg-muted hover:text-foreground"
			)}
			search={{ tab: id }}
			to="/local-agents"
		>
			{label}
		</Link>
	);
}

function LocalAgentsPage() {
	const { tab = DEFAULT_TAB } = Route.useSearch();

	return (
		<div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 p-4 sm:p-6">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<nav className="flex shrink-0 flex-row gap-1">
					{TABS.map((t) => (
						<LocalAgentsTabLink active={t.id === tab} key={t.id} {...t} />
					))}
				</nav>
				{tab === "sessions" ? <AddLocalAgentDialog /> : null}
			</div>
			{tab === "sessions" ? (
				<LocalAgentList />
			) : (
				<div className="overflow-auto">
					<TokenManager />
				</div>
			)}
		</div>
	);
}
