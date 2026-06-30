import { Avatar, AvatarFallback } from "@better-agent/ui/components/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@better-agent/ui/components/dropdown-menu";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { TOKEN_KEY } from "@/api";
import { SettingsDialog } from "@/components/settings-dialog";

function AvatarMenu({ onSettingsClick }: { onSettingsClick: () => void }) {
	const navigate = useNavigate();

	function handleLogout() {
		localStorage.removeItem(TOKEN_KEY);
		navigate({ to: "/login" });
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger>
				<Avatar>
					<AvatarFallback>A</AvatarFallback>
				</Avatar>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={onSettingsClick}>Settings</DropdownMenuItem>
				<DropdownMenuItem onClick={handleLogout}>Logout</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function TopBar({ onSettingsClick }: { onSettingsClick: () => void }) {
	return (
		<div className="flex items-center justify-between py-3">
			<span className="font-semibold text-sm">authz</span>
			<AvatarMenu onSettingsClick={onSettingsClick} />
		</div>
	);
}

export function AppShell({ children }: { children: ReactNode }) {
	const [settingsOpen, setSettingsOpen] = useState(false);

	return (
		<div className="mx-auto w-full max-w-5xl px-4">
			<TopBar onSettingsClick={() => setSettingsOpen(true)} />
			<SettingsDialog onOpenChange={setSettingsOpen} open={settingsOpen} />
			{children}
		</div>
	);
}
