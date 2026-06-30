import type { CancellationRegistry } from "@better-agent/agent/session/cancellation";
import type { Redis } from "@upstash/redis";

const POLL_INTERVAL_MS = 750;
const CANCEL_TTL_SEC = 60;

function keyFor(sessionId: string): string {
	return `cancel:${sessionId}`;
}

/**
 * Upstash REST cancellation registry. `cancel` SETs a flag; each live turn polls
 * (GET) for its own flag and aborts when it appears. Works across Cloudflare
 * Worker isolates over HTTP (the in-memory registry can't: cancel() lands on a
 * different isolate than the streaming turn, so its abort never fires).
 */
export function createUpstashCancellationRegistry(
	redis: Redis
): CancellationRegistry {
	const timers = new Map<string, ReturnType<typeof setInterval>>();

	const stop = (sessionId: string) => {
		const timer = timers.get(sessionId);
		if (timer) {
			clearInterval(timer);
			timers.delete(sessionId);
		}
	};

	return {
		register(sessionId, controller) {
			stop(sessionId);
			const timer = setInterval(() => {
				redis
					.get<string>(keyFor(sessionId))
					.then((flag) => {
						if (flag) {
							controller.abort();
							stop(sessionId);
							return redis.del(keyFor(sessionId));
						}
						return 0;
					})
					.catch(() => undefined);
			}, POLL_INTERVAL_MS);
			timers.set(sessionId, timer);
		},
		unregister(sessionId) {
			stop(sessionId);
		},
		cancel(sessionId) {
			return redis
				.set(keyFor(sessionId), "1", { ex: CANCEL_TTL_SEC })
				.then(() => undefined);
		},
	};
}
