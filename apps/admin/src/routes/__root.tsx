import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@better-agent/ui/components/sidebar";
import { Toaster } from "@better-agent/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";

import { RouteProgress } from "@/components/route-progress";
import { RouteTransition } from "@/components/route-transition";
import { AdminSidebar } from "@/components/sidebar";
import type { orpc } from "@/utils/orpc";

import appCss from "../index.css?url";

export interface RouterAppContext {
	orpc: typeof orpc;
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "better-agent admin" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	component: RootDocument,
});

function RootDocument() {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<RouteProgress />
				<SidebarProvider className="h-svh overflow-hidden">
					<AdminSidebar />
					<SidebarInset className="min-h-0 overflow-hidden">
						<header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
							<SidebarTrigger />
							<span className="font-medium text-sm">better-agent</span>
						</header>
						<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
							<RouteTransition>
								<Outlet />
							</RouteTransition>
						</div>
					</SidebarInset>
				</SidebarProvider>
				<Toaster richColors />
				<Scripts />
			</body>
		</html>
	);
}
