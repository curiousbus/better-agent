import type { NavSection } from "@better-agent/ui/components/app-shell-sidebar";
import { AppShellSidebar } from "@better-agent/ui/components/app-shell-sidebar";
import { Bot, Home, LayoutDashboard } from "lucide-react";

import { UserMenu } from "@/components/user-menu";

const SECTIONS: readonly NavSection[] = [
	{
		kind: "item",
		item: { to: "/", label: "Home", icon: Home },
	},
	{
		kind: "item",
		item: { to: "/board", label: "Board", icon: LayoutDashboard },
	},
];

export function WebSidebar() {
	return (
		<AppShellSidebar
			brand={{ icon: Bot, title: "better-agent" }}
			footer={<UserMenu />}
			highlightLayoutId="web-sidebar-active"
			sections={SECTIONS}
		/>
	);
}
