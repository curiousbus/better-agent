import { Separator } from "@better-agent/ui/components/separator";
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
	useRouterState,
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

const PAGE_TITLES: Record<string, string> = {
	providers: "Providers",
	agents: "Agents",
};

function titleForPath(pathname: string) {
	const segment = pathname.split("/").filter(Boolean).at(0) ?? "";
	return PAGE_TITLES[segment] ?? "better-agent admin";
}

function PageTitle() {
	const title = useRouterState({
		select: (s) => titleForPath(s.location.pathname),
	});
	return <span className="font-medium text-sm">{title}</span>;
}

function RootDocument() {
	return (
		<html className="dark" lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<SidebarProvider>
					<AdminSidebar />
					<SidebarInset>
						<header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
							<SidebarTrigger className="-ml-1" />
							<Separator className="mx-1 h-4" orientation="vertical" />
							<PageTitle />
						</header>
						<div className="flex-1 overflow-auto p-6" data-slot="page">
							<Outlet />
						</div>
					</SidebarInset>
				</SidebarProvider>
				<Toaster richColors />
				<Scripts />
			</body>
		</html>
	);
}
