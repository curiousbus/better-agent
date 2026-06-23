import { buttonVariants } from "@better-agent/ui/components/button";
import { cn } from "@better-agent/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Bot, Boxes, PlusIcon, Settings2 } from "lucide-react";

import { orpc } from "@/utils/orpc";

const railLink = (active: boolean) =>
	cn(
		"flex items-center gap-2 rounded-md px-2 py-1.5 text-sidebar-foreground text-sm transition-colors hover:bg-sidebar-accent",
		active && "bg-sidebar-accent font-medium"
	);

const sectionLabel = "px-2 pt-3 pb-1 font-medium text-muted-foreground text-xs";

function RailAgents({ pathname }: { pathname: string }) {
	const agents = useQuery(orpc.agents.list.queryOptions());
	const agentRows = agents.data ?? [];
	return (
		<nav className="-mr-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
			{agentRows.map((agent) => (
				<Link
					className={railLink(pathname.startsWith(`/agents/${agent.id}`))}
					key={agent.id}
					params={{ agentId: agent.id }}
					to="/agents/$agentId"
				>
					<Bot className="size-4 shrink-0 text-muted-foreground" />
					<span className="truncate">{agent.name}</span>
				</Link>
			))}
			{!agents.isLoading && agentRows.length === 0 ? (
				<p className="px-2 py-1 text-muted-foreground text-xs">
					No agents yet.
				</p>
			) : null}
		</nav>
	);
}

export function AdminRail() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	return (
		<aside className="flex h-svh w-64 shrink-0 flex-col border-sidebar-border border-r bg-sidebar px-3 py-3 text-sidebar-foreground">
			<div className="flex items-center gap-2 px-2 py-1">
				<div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
					<Bot className="size-4" />
				</div>
				<span className="font-semibold text-sm">better-agent</span>
			</div>

			<Link
				className={cn(
					buttonVariants({ variant: "outline", size: "default" }),
					"mt-3 w-full justify-start gap-2"
				)}
				to="/"
			>
				<PlusIcon className="size-4" />
				New chat
			</Link>

			<div className={sectionLabel}>Agents</div>
			<RailAgents pathname={pathname} />

			<div className={sectionLabel}>Settings</div>
			<Link
				className={railLink(pathname.startsWith("/providers"))}
				to="/providers"
			>
				<Settings2 className="size-4 shrink-0 text-muted-foreground" />
				<span className="truncate">Providers</span>
			</Link>
			<Link className={railLink(pathname === "/agents")} to="/agents">
				<Boxes className="size-4 shrink-0 text-muted-foreground" />
				<span className="truncate">Manage agents</span>
			</Link>
		</aside>
	);
}
