import type { CancellationRegistry } from "@better-agent/agent/session/cancellation";
import { log } from "evlog";
import type { Redis } from "ioredis";

const CANCEL_CHANNEL = "session-cancel";

export function createRedisCancellationRegistry(
	redis: Redis
): CancellationRegistry {
	const subscriber = redis.duplicate();
	const active = new Map<string, AbortController>();

	const onError = (err: Error) =>
		log.error({ action: "redis cancellation error", error: String(err) });
	redis.on("error", onError);
	subscriber.on("error", onError);

	subscriber.on("message", (_channel: string, sessionId: string) => {
		active.get(sessionId)?.abort();
		active.delete(sessionId);
	});
	subscriber.subscribe(CANCEL_CHANNEL);

	return {
		register(sessionId, controller) {
			active.set(sessionId, controller);
		},
		unregister(sessionId) {
			active.delete(sessionId);
		},
		async cancel(sessionId) {
			await redis.publish(CANCEL_CHANNEL, sessionId);
		},
	};
}
