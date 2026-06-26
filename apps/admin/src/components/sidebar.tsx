import type { NavSection } from "@better-agent/ui/components/app-shell-sidebar";
import { AppShellSidebar } from "@better-agent/ui/components/app-shell-sidebar";
import {
	Bot,
	Boxes,
	Settings2,
	SlidersHorizontal,
	Users,
	Wrench,
} from "lucide-react";

const SECTIONS: readonly NavSection[] = [
	{
		kind: "item",
		item: { to: "/providers", label: "Providers", icon: Settings2 },
	},
	{
		kind: "item",
		item: { to: "/agents", label: "Agents", icon: Boxes },
	},
	{
		kind: "item",
		item: { to: "/tools", label: "Tools", icon: Wrench },
	},
	{
		kind: "item",
		item: { to: "/users", label: "Users", icon: Users },
	},
	{
		kind: "item",
		item: { to: "/settings", label: "Settings", icon: SlidersHorizontal },
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
