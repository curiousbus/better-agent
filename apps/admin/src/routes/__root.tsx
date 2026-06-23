import { Toaster } from "@better-agent/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";

import { AdminRail } from "@/components/rail";
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
				<div className="flex h-svh overflow-hidden">
					<AdminRail />
					<main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
						<Outlet />
					</main>
				</div>
				<Toaster richColors />
				<Scripts />
			</body>
		</html>
	);
}
