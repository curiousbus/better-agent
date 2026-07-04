import type { RelayEvent, RelayStore } from "@better-agent/agent/ports";
import type { Context } from "../context";
import { requireOwnedBridgeSession } from "./ownership";

export interface ObserveOptions {
	afterId: number;
	onEvent: (event: RelayEvent) => void;
	relayStore: RelayStore;
	sessionId: string;
}

/**
 * Subscribes to a bridge session's live `events↑` channel, replays anything
 * after `afterId`, and dedupes so a consumer sees each event exactly once, in
 * order. Returns an unsubscribe function.
 *
 * Ordering: per RelayStore.subscribe's contract, subscribe() runs BEFORE
 * read(afterId) so no event is missed — but a live event can then arrive
 * while the replay read is still in flight. Forwarding it immediately would
 * let it jump ahead of the backlog it depends on, so live events are buffered
 * until the replay is fully delivered, then flushed in arrival order.
 */
export function observeBridgeEvents(options: ObserveOptions): () => void {
	const { relayStore, sessionId, afterId, onEvent } = options;
	const seen = new Set<number>();
	let replayDone = false;
	const buffered: RelayEvent[] = [];

	function dispatch(event: RelayEvent): void {
		if (seen.has(event.id)) {
			return;
		}
		seen.add(event.id);
		onEvent(event);
	}

	const unsubscribe = relayStore.subscribe(sessionId, "events", (event) => {
		if (replayDone) {
			dispatch(event);
		} else {
			buffered.push(event);
		}
	});

	relayStore.read(sessionId, "events", afterId).then((events) => {
		for (const event of events) {
			dispatch(event);
		}
		replayDone = true;
		for (const event of buffered) {
			dispatch(event);
		}
		buffered.length = 0;
	});

	return unsubscribe;
}

const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;

export type StreamAuthResult =
	| { ok: true; userId: string }
	| { ok: false; status: typeof HTTP_UNAUTHORIZED | typeof HTTP_NOT_FOUND };

/**
 * Resolves + authorizes an observe-stream request: the caller must be a
 * signed-in user who owns the bridge session. Kept separate from the raw Hono
 * route so it (and the ordering-critical observeBridgeEvents above) can be
 * unit-tested without booting an HTTP server.
 */
export async function resolveStreamAuth(
	context: Context,
	sessionId: string
): Promise<StreamAuthResult> {
	const user = context.authedUser;
	if (!user) {
		return { ok: false, status: HTTP_UNAUTHORIZED };
	}
	try {
		await requireOwnedBridgeSession(context, user.id, sessionId);
		return { ok: true, userId: user.id };
	} catch {
		return { ok: false, status: HTTP_NOT_FOUND };
	}
}
