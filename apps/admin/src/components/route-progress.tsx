import { TopProgress } from "@better-agent/ui/components/top-progress";
import { useIsFetching } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";

/** Drives the shared TopProgress bar from route + query state. */
export function RouteProgress() {
	const navigating = useRouterState({ select: (state) => state.isLoading });
	const fetching = useIsFetching();
	return <TopProgress active={navigating || fetching > 0} />;
}
