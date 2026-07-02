import type { NavSection } from "@better-agent/ui/components/app-shell-sidebar";
import { AppShellSidebar } from "@better-agent/ui/components/app-shell-sidebar";
import { Bot, Gauge, LayoutDashboard, Plug } from "lucide-react";

import { UserMenu } from "@/components/user-menu";

// Chat is not a top-level nav item — you open a chat from an agent (its row's
// chat action → /chat?agentId=…).
const SECTIONS: readonly NavSection[] = [
	{
		kind: "item",
		item: { to: "/dashboard", label: "Dashboard", icon: Gauge },
	},
	{
		kind: "item",
		item: { to: "/board", label: "Board", icon: LayoutDashboard },
	},
	{
		kind: "item",
		item: { to: "/agents", label: "Agents", icon: Bot },
	},
	{
		kind: "item",
		item: { to: "/integrations", label: "Integrations", icon: Plug },
	},
];

export function WebSidebar() {
	return (
		<AppShellSidebar
			brand={{ icon: Bot, title: "better-agent" }}
			footer={<UserMenu />}
			highlightLayoutId="web-sidebar-active"
			sections={SECTIONS}
			variant="sidebar"
		/>
	);
}
