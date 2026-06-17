import { Link } from "@tanstack/react-router";
import { Boxes, MessagesSquare, Settings2 } from "lucide-react";

const NAV = [
	{ to: "/providers", label: "Providers", icon: Settings2 },
	{ to: "/agents", label: "Agents", icon: Boxes },
	{ to: "/sessions", label: "Sessions", icon: MessagesSquare },
] as const;

export function AppSidebar() {
	return (
		<aside className="w-56 shrink-0 border-r bg-card p-3">
			<div className="mb-4 px-2 font-semibold text-sm">better-agent admin</div>
			<nav className="flex flex-col gap-1">
				{NAV.map((item) => (
					<Link
						activeProps={{ className: "bg-accent text-accent-foreground" }}
						className="flex items-center gap-2 rounded-none px-2 py-1.5 text-muted-foreground text-sm hover:bg-accent/50"
						key={item.to}
						to={item.to}
					>
						<item.icon className="size-4" />
						{item.label}
					</Link>
				))}
			</nav>
		</aside>
	);
}
