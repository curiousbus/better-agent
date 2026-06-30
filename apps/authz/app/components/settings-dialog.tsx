import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { decodeJwtEmail, TOKEN_KEY } from "@/api";

const THEME_KEY = "authz_theme";

function getInitialTheme(): string {
	return localStorage.getItem(THEME_KEY) ?? "light";
}

function applyTheme(theme: string): void {
	if (theme === "dark") {
		document.documentElement.classList.add("dark");
	} else {
		document.documentElement.classList.remove("dark");
	}
}

function toggleTheme(): void {
	const current = localStorage.getItem(THEME_KEY) ?? "light";
	const next = current === "dark" ? "light" : "dark";
	localStorage.setItem(THEME_KEY, next);
	applyTheme(next);
}

export function SettingsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
}) {
	const token = localStorage.getItem(TOKEN_KEY);
	const email = decodeJwtEmail(token) ?? "Signed in";
	const theme = getInitialTheme();

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Settings</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-4">
					<p className="text-muted-foreground text-xs">
						Signed in as{" "}
						<span className="font-medium text-foreground">{email}</span>
					</p>
					<div className="flex items-center justify-between">
						<span className="text-xs">Theme</span>
						<Button onClick={toggleTheme} size="sm" variant="outline">
							{theme === "dark" ? "Light mode" : "Dark mode"}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
