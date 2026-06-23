import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@better-agent/ui/components/sidebar";
import { Toaster } from "@better-agent/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { createMiddleware } from "@tanstack/react-start";
import { evlogErrorHandler } from "evlog/nitro/v3";

import { WebSidebar } from "@/components/sidebar";
import type { orpc } from "@/utils/orpc";

import appCss from "../index.css?url";

export interface RouterAppContext {
	orpc: typeof orpc;
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	server: {
		middleware: [createMiddleware().server(evlogErrorHandler)],
	},

	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "better-agent" },
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
				<Toaster richColors />
				<TanStackRouterDevtools position="bottom-left" />
				<ReactQueryDevtools buttonPosition="bottom-right" position="bottom" />
				<Scripts />
			</body>
		</html>
	);
}
