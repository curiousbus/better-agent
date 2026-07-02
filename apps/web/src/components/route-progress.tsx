import { TopProgress } from "@better-agent/ui/components/top-progress";
import { useRouterState } from "@tanstack/react-router";

/**
 * Drives the shared TopProgress bar from ROUTE state only. Deliberately not
 * wired to react-query's global fetching count — background refetches (chat
 * history, observing-mode polling) would flash the bar constantly mid-chat.
 */
export function RouteProgress({ active = false }: { active?: boolean }) {
	const navigating = useRouterState({ select: (state) => state.isLoading });
	return <TopProgress active={active || navigating} />;
}
