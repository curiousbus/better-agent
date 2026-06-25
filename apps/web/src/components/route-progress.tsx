import { useIsFetching } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";

/**
 * A fixed top bar that runs an indeterminate "streaming" sweep whenever work is
 * in flight: route navigation, any in-flight query, or an external `active`
 * signal (e.g. auth bootstrap). Honest indeterminate motion — it never fakes a
 * percentage.
 */
export function RouteProgress({ active = false }: { active?: boolean }) {
	const navigating = useRouterState({ select: (state) => state.isLoading });
	const fetching = useIsFetching();
	const on = active || navigating || fetching > 0;
	return <div aria-hidden="true" className="route-progress" data-active={on} />;
}
