import { PageTransition } from "@better-agent/ui/components/page-transition";
import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** Slides the new route's content in on every navigation. */
export function RouteTransition({ children }: { children: ReactNode }) {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	return <PageTransition animationKey={pathname}>{children}</PageTransition>;
}
