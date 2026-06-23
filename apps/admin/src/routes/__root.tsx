import {
	SidebarInset,
	SidebarProvider,
} from "@better-agent/ui/components/sidebar";
import { Toaster } from "@better-agent/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";

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
				<SidebarProvider>
					<AdminSidebar />
					<SidebarInset className="min-h-0 overflow-hidden">
						<Outlet />
					</SidebarInset>
				</SidebarProvider>
				<Toaster richColors />
				<Scripts />
			</body>
		</html>
	);
}
