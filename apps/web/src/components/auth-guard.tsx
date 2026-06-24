import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@better-agent/ui/components/sidebar";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { WebSidebar } from "@/components/sidebar";
import { getAccessToken, loadRefreshToken, setTokens } from "@/utils/auth";
import { client } from "@/utils/orpc";

const PUBLIC_PATHS = ["/login", "/auth/verify"];

// On load, mint a fresh access token from the stored refresh token (if any)
// before deciding whether the user is signed in. Returns whether bootstrap
// has finished; sign-in state is read live from getAccessToken().
function useAuthBootstrap(): boolean {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		let active = true;
		const refreshToken = loadRefreshToken();
		if (refreshToken) {
			client.auth
				.refresh({ refreshToken })
				.then((result) => setTokens(result))
				.catch(() => {
					// Stored refresh token is invalid/expired; stay signed out.
				})
				.finally(() => {
					if (active) {
						setReady(true);
					}
				});
		} else {
			setReady(true);
		}
		return () => {
			active = false;
		};
	}, []);
	return ready;
}

function AuthedShell() {
	return (
		<SidebarProvider className="h-svh overflow-hidden">
			<WebSidebar />
			<SidebarInset className="min-h-0 overflow-hidden">
				<header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
					<SidebarTrigger />
					<span className="font-medium text-sm">better-agent</span>
				</header>
				<div className="flex min-h-0 flex-1 flex-col overflow-auto">
					<Outlet />
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}

function LoadingScreen() {
	return (
		<div className="flex h-svh items-center justify-center text-muted-foreground text-sm">
			Loading…
		</div>
	);
}

export function AuthBoundary() {
	const ready = useAuthBootstrap();
	const navigate = useNavigate();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
	// Read live each render: after /auth/verify calls setTokens, this becomes
	// non-null on the next render, so the just-signed-in user isn't redirected.
	const authed = getAccessToken() !== null;
	useEffect(() => {
		if (!isPublic && ready && !authed) {
			navigate({ to: "/login" });
		}
	}, [isPublic, ready, authed, navigate]);
	if (isPublic) {
		return (
			<main className="flex min-h-svh flex-col">
				<Outlet />
			</main>
		);
	}
	if (!ready) {
		return <LoadingScreen />;
	}
	if (!authed) {
		return <LoadingScreen />;
	}
	return <AuthedShell />;
}
