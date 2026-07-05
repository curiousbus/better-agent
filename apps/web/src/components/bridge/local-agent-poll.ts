/** Polling cadence for `bridge.listSessions`, shared by the list page (whose
 * query drives the cards) and the detail page. Without a shared poll, the
 * detail page's status chip and `lastSeenAt` would freeze the moment the
 * list page unmounts, since that was the only query keeping the row fresh. */
export const SESSION_POLL_INTERVAL_MS = 5000;

/** Applies the shared polling cadence to a `listSessions` query-options
 * object without touching its other fields. Kept as a small pure helper
 * (rather than inlining `refetchInterval` at each call site) so it's cheap
 * to unit test and impossible for the two pages' poll intervals to drift. */
export function withSessionPolling<T extends { queryKey: unknown }>(
	queryOptions: T
): T & { refetchInterval: number } {
	return { ...queryOptions, refetchInterval: SESSION_POLL_INTERVAL_MS };
}
