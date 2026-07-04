import { cn } from "@better-agent/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { createBridgeTransport } from "@/components/bridge/bridge-transport";
import { SessionList } from "@/components/bridge/session-list";
import { Terminal } from "@/components/bridge/terminal";
import { TokenManager } from "@/components/bridge/token-manager";
import { orpc } from "@/utils/orpc";

type BridgeTab = "sessions" | "tokens";

const DEFAULT_TAB: BridgeTab = "sessions";

const TABS: ReadonlyArray<{ id: BridgeTab; label: string }> = [
	{ id: "sessions", label: "Sessions" },
	{ id: "tokens", label: "Tokens" },
];

function isBridgeTab(value: unknown): value is BridgeTab {
	return value === "sessions" || value === "tokens";
}

export const Route = createFileRoute("/bridge/")({
	component: BridgePage,
	validateSearch: (search: Record<string, unknown>): { tab?: BridgeTab } => ({
		tab: isBridgeTab(search.tab) ? search.tab : undefined,
	}),
});

function BridgeTabLink({
	active,
	id,
	label,
}: {
	active: boolean;
	id: BridgeTab;
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
			to="/bridge"
		>
			{label}
		</Link>
	);
}

function SessionsPanel() {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const sessions = useQuery(orpc.bridge.listSessions.queryOptions());
	const transport = useMemo(() => createBridgeTransport(), []);
	const selected = sessions.data?.find((row) => row.id === selectedId) ?? null;

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 sm:flex-row">
			<div className="min-w-0 overflow-auto sm:w-64 sm:shrink-0">
				<SessionList onSelect={setSelectedId} selectedId={selectedId} />
			</div>
			<div className="flex min-h-0 flex-1 flex-col">
				{selected ? (
					<Terminal session={selected} transport={transport} />
				) : (
					<p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
						Select a session to view its live terminal.
					</p>
				)}
			</div>
		</div>
	);
}

function BridgePage() {
	const { tab = DEFAULT_TAB } = Route.useSearch();

	return (
		<div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 p-4 sm:p-6">
			<nav className="flex shrink-0 flex-row gap-1">
				{TABS.map((t) => (
					<BridgeTabLink active={t.id === tab} key={t.id} {...t} />
				))}
			</nav>
			{tab === "sessions" ? (
				<SessionsPanel />
			) : (
				<div className="overflow-auto">
					<TokenManager />
				</div>
			)}
		</div>
	);
}
