import type { NavSection } from "@better-agent/ui/components/app-shell-sidebar";
import { AppShellSidebar } from "@better-agent/ui/components/app-shell-sidebar";
import { Bot, Gauge, LayoutDashboard, MessageSquare } from "lucide-react";

import { UserMenu } from "@/components/user-menu";

const SECTIONS: readonly NavSection[] = [
	{
		kind: "item",
		item: { to: "/", label: "Dashboard", icon: Gauge },
	},
	{
		kind: "item",
		item: { to: "/chat", label: "Chat", icon: MessageSquare },
	},
	{
		kind: "item",
		item: { to: "/board", label: "Board", icon: LayoutDashboard },
	},
	{
		kind: "item",
		item: { to: "/agents", label: "Agents", icon: Bot },
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
