import { expect, it } from "vitest";
import {
	SESSION_POLL_INTERVAL_MS,
	withSessionPolling,
} from "./local-agent-poll";

it("applies the shared poll interval on top of the given query options", () => {
	const queryOptions = { queryKey: ["bridge", "listSessions"], staleTime: 0 };

	expect(withSessionPolling(queryOptions)).toEqual({
		...queryOptions,
		refetchInterval: SESSION_POLL_INTERVAL_MS,
	});
});

it("is the value the list and detail pages must both poll at", () => {
	// Regression guard for the bug this helper fixes: the detail page had no
	// poll of its own and relied on the list page's, which unmounts on
	// navigation — freezing lastSeenAt/status forever. Both pages now call
	// `withSessionPolling`, so this constant is the single source of truth.
	expect(withSessionPolling({ queryKey: [] }).refetchInterval).toBe(
		SESSION_POLL_INTERVAL_MS
	);
});
