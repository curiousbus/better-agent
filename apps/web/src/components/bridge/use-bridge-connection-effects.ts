import type { Dispatch, MutableRefObject } from "react";
import { useEffect, useRef } from "react";
import type { BridgeTransport } from "./bridge-transport";
import type { ConnectionAction, ConnectionState } from "./terminal-connection";
import type { FeedAction } from "./use-bridge-feed";

const POLL_INTERVAL_MS = 2000;

// A useEffect callback must return consistently (always a cleanup function or
// never); biome's formatter also collapses `return undefined;` to a bare
// `return;`, which then trips eslint's consistent-return against a sibling
// `return unsubscribe;`. Returning this shared no-op keeps every path
// returning a function.
function noCleanup(): void {
	// nothing to clean up on this path
}

/** Resets the feed + connection state whenever the selected session changes. */
export function useResetOnSessionChange(
	sessionId: string,
	dispatchFeed: Dispatch<FeedAction>,
	dispatchConn: Dispatch<ConnectionAction>
): void {
	// sessionId isn't read in the body — it's the intentional re-run trigger
	// (switching sessions is exactly when the feed/connection must reset).
	// biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is a deliberate trigger-only dependency, see comment above
	useEffect(() => {
		dispatchFeed({ type: "reset" });
		dispatchConn({ type: "reset" });
	}, [sessionId, dispatchFeed, dispatchConn]);
}

/** A ref mirror of `maxSeenId`, read by the connect/poll effects below without
 * being a dependency of theirs — including it directly would tear down and
 * reopen the SSE connection (or restart the poll interval) on every single
 * event, instead of only on session/status changes. */
export function useMaxSeenIdRef(maxSeenId: number): MutableRefObject<number> {
	const ref = useRef(maxSeenId);
	useEffect(() => {
		ref.current = maxSeenId;
	}, [maxSeenId]);
	return ref;
}

export interface SseConnectionArgs {
	conn: ConnectionState;
	dispatchConn: Dispatch<ConnectionAction>;
	dispatchFeed: Dispatch<FeedAction>;
	maxSeenIdRef: MutableRefObject<number>;
	sessionId: string;
	transport: BridgeTransport;
}

/** Owns the live SSE connection: opens it while not degraded to polling, and
 * reopens on every failure (until the connection reducer's threshold flips
 * status to "polling", at which point this effect stops attempting). */
export function useSseConnection(args: SseConnectionArgs): void {
	const {
		sessionId,
		conn,
		maxSeenIdRef,
		transport,
		dispatchFeed,
		dispatchConn,
	} = args;
	// conn.failureCount (not just conn.status) is a dependency on purpose: it's
	// what changes on each retry attempt while status stays "connecting".
	// maxSeenIdRef.current is deliberately excluded (see useMaxSeenIdRef doc) —
	// it's read as a ref, not a reactive dependency, to avoid tearing down and
	// reopening the stream on every event.
	// biome-ignore lint/correctness/useExhaustiveDependencies: conn.failureCount is deliberate (see comment above), maxSeenIdRef.current is deliberately excluded (see useMaxSeenIdRef doc)
	useEffect(() => {
		if (conn.status === "polling") {
			return noCleanup;
		}
		const unsubscribe = transport.connectStream({
			sessionId,
			afterId: maxSeenIdRef.current,
			onOpen: () => dispatchConn({ type: "open" }),
			onEvent: (raw) => dispatchFeed({ type: "events", events: [raw] }),
			onError: () => dispatchConn({ type: "error" }),
		});
		return unsubscribe;
	}, [
		sessionId,
		conn.status,
		conn.failureCount,
		transport,
		dispatchFeed,
		dispatchConn,
	]);
}

export interface PollFallbackArgs {
	dispatchConn: Dispatch<ConnectionAction>;
	dispatchFeed: Dispatch<FeedAction>;
	maxSeenIdRef: MutableRefObject<number>;
	sessionId: string;
	status: ConnectionState["status"];
	transport: BridgeTransport;
}

/** Degraded steady-state: polls `observe(afterId)` on a fixed interval while
 * status is "polling". Runs one poll immediately so the fallback doesn't wait
 * a full interval before showing anything. */
export function usePollFallback(args: PollFallbackArgs): void {
	const {
		sessionId,
		status,
		maxSeenIdRef,
		transport,
		dispatchFeed,
		dispatchConn,
	} = args;
	useEffect(() => {
		if (status !== "polling") {
			return noCleanup;
		}
		let cancelled = false;
		const poll = async () => {
			try {
				const events = await transport.observe({
					sessionId,
					afterId: maxSeenIdRef.current,
				});
				if (cancelled) {
					return;
				}
				dispatchFeed({ type: "events", events });
				dispatchConn({ type: "polled" });
			} catch {
				// transient poll failure: silently retried on the next tick
			}
		};
		poll();
		const interval = setInterval(poll, POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [sessionId, status, transport, maxSeenIdRef, dispatchFeed, dispatchConn]);
}
