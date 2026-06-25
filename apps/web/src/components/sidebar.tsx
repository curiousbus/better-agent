import type { NavSection } from "@better-agent/ui/components/app-shell-sidebar";
import { AppShellSidebar } from "@better-agent/ui/components/app-shell-sidebar";
import { Bot, Home, User } from "lucide-react";

const SECTIONS: readonly NavSection[] = [
	{
		kind: "item",
		item: { to: "/", label: "Home", icon: Home },
	},
	{
		kind: "item",
		item: { to: "/account", label: "Account", icon: User },
	},
];

export function WebSidebar() {
	return (
		<AppShellSidebar
			brand={{ icon: Bot, title: "better-agent" }}
			highlightLayoutId="web-sidebar-active"
			sections={SECTIONS}
		/>
	);
}
