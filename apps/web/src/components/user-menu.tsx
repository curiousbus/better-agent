import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@better-agent/ui/components/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@better-agent/ui/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOutIcon, SettingsIcon } from "lucide-react";
import { clearTokens, loadRefreshToken } from "@/utils/auth";
import { userAvatar } from "@/utils/avatar";
import { client, orpc } from "@/utils/orpc";

export function UserMenu() {
	const navigate = useNavigate();
	const me = useQuery(orpc.auth.me.queryOptions());
	const email = me.data?.email ?? "";
	const initial = email ? email[0].toUpperCase() : "?";

	const signOut = async () => {
		const refreshToken = loadRefreshToken();
		if (refreshToken) {
			await client.auth.logout({ refreshToken });
		}
		clearTokens();
		navigate({ to: "/login" });
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<button
						className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 text-left text-sidebar-foreground text-sm outline-none hover:bg-sidebar-accent"
						type="button"
					/>
				}
			>
				<Avatar size="sm">
					<AvatarImage alt={email} src={userAvatar(email)} />
					<AvatarFallback>{initial}</AvatarFallback>
				</Avatar>
				{/* Email hidden when the sidebar collapses to icon-only — keeps the
				    trigger avatar-sized so it can't pile up against the theme toggle. */}
				<span className="truncate text-muted-foreground text-xs group-data-[collapsible=icon]:hidden">
					{email}
				</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-48" side="top">
				<DropdownMenuItem onClick={() => navigate({ to: "/account" })}>
					<SettingsIcon className="size-4" />
					Settings
				</DropdownMenuItem>
				<DropdownMenuItem onClick={signOut}>
					<LogOutIcon className="size-4" />
					Log out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
