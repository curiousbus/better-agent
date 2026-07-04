import {
	MAX_WINDOW,
	type RelayDir,
	type RelayEvent,
	type RelayStore,
	WINDOW_TTL_SEC,
} from "@better-agent/agent/bridge/relay-store";
import { log } from "evlog";
import type { Redis } from "ioredis";

const LAST_INDEX = -1;
const WINDOW_START_INDEX = -MAX_WINDOW;

function seqKey(sessionId: string, dir: RelayDir): string {
	return `bridge:${sessionId}:${dir}:seq`;
}

function listKey(sessionId: string, dir: RelayDir): string {
	return `bridge:${sessionId}:${dir}`;
}

function channelFor(sessionId: string, dir: RelayDir): string {
	return `bridge:${sessionId}:${dir}`;
}

function logRelayError(action: string, err: Error): void {
	log.error({ action, error: String(err) });
}

async function appendEvent(
	redis: Redis,
	sessionId: string,
	dir: RelayDir,
	data: unknown
): Promise<number> {
	const id = await redis.incr(seqKey(sessionId, dir));
	const event: RelayEvent = { id, data };
	const payload = JSON.stringify(event);
	const key = listKey(sessionId, dir);

	await redis.rpush(key, payload);
	await redis.ltrim(key, WINDOW_START_INDEX, LAST_INDEX);
	await redis.expire(key, WINDOW_TTL_SEC);
	await redis.expire(seqKey(sessionId, dir), WINDOW_TTL_SEC);
	await redis.publish(channelFor(sessionId, dir), payload);

	return id;
}

async function readEvents(
	redis: Redis,
	sessionId: string,
	dir: RelayDir,
	afterId: number
): Promise<RelayEvent[]> {
	const raw = await redis.lrange(listKey(sessionId, dir), 0, LAST_INDEX);
	return raw
		.map((item) => JSON.parse(item) as RelayEvent)
		.filter((event) => event.id > afterId);
}

type ListenersByChannel = Map<string, Set<(event: RelayEvent) => void>>;

/** A dedicated ioredis connection in subscriber mode, routing incoming
 * messages to the listeners registered for their channel. */
function createSubscriberConnection(
	redis: Redis,
	listeners: ListenersByChannel
): Redis {
	const sub = redis.duplicate();
	sub.on("error", (err: Error) => {
		logRelayError("redis relay-store subscriber error", err);
	});
	sub.on("message", (channel: string, payload: string) => {
		const subs = listeners.get(channel);
		if (!subs) {
			return;
		}
		const event = JSON.parse(payload) as RelayEvent;
		for (const listener of subs) {
			listener(event);
		}
	});
	return sub;
}

/** Lazily-created, shared subscriber connection routing messages by channel. */
function createSubscriberRouter(redis: Redis) {
	let subscriber: Redis | null = null;
	const listeners: ListenersByChannel = new Map();

	function ensureSubscriber(): Redis {
		subscriber ??= createSubscriberConnection(redis, listeners);
		return subscriber;
	}

	function subscribe(
		channel: string,
		onEvent: (event: RelayEvent) => void
	): () => void {
		const sub = ensureSubscriber();
		let subs = listeners.get(channel);
		if (!subs) {
			subs = new Set();
			listeners.set(channel, subs);
			sub.subscribe(channel).catch((err: Error) => {
				logRelayError("redis relay-store subscribe error", err);
			});
		}
		subs.add(onEvent);

		return () => {
			subs.delete(onEvent);
			if (subs.size === 0) {
				listeners.delete(channel);
				sub.unsubscribe(channel).catch((err: Error) => {
					logRelayError("redis relay-store unsubscribe error", err);
				});
			}
		};
	}

	return { subscribe };
}

export function createRedisRelayStore(redis: Redis): RelayStore {
	redis.on("error", (err: Error) => {
		logRelayError("redis relay-store error", err);
	});

	const router = createSubscriberRouter(redis);

	return {
		append: (sessionId, dir, data) => appendEvent(redis, sessionId, dir, data),

		read: (sessionId, dir, afterId) =>
			readEvents(redis, sessionId, dir, afterId),

		subscribe: (sessionId, dir, onEvent) =>
			router.subscribe(channelFor(sessionId, dir), onEvent),
	};
}
