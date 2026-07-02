import type { NavSection } from "@better-agent/ui/components/app-shell-sidebar";
import { AppShellSidebar } from "@better-agent/ui/components/app-shell-sidebar";
import { Bot, Settings2, Users } from "lucide-react";

const SECTIONS: readonly NavSection[] = [
	{
		kind: "item",
		item: { to: "/customers", label: "Customers", icon: Users },
	},
	{
		kind: "item",
		item: { to: "/providers", label: "Providers", icon: Settings2 },
	},
	{
		kind: "item",
		item: { to: "/users", label: "Users", icon: Users },
	},
];

export function AdminSidebar() {
	return (
		<AppShellSidebar
			brand={{ icon: Bot, title: "better-agent", subtitle: "管理后台" }}
			highlightLayoutId="admin-sidebar-active"
			sections={SECTIONS}
		/>
	);
}
