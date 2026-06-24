import { randomUUID } from "node:crypto";
import type { SessionLock } from "@better-agent/agent/session/session-lock";
import { log } from "evlog";
import type { Redis } from "ioredis";

// A turn (multi-step tool loops) can run for minutes; the TTL only exists so a
// crashed instance cannot deadlock a session forever. Release is token-guarded
// so a turn that outlives the TTL never deletes a successor instance's lock.
const LOCK_TTL_MS = 300_000;

// KEYS[1]=lock key, ARGV[1]=token. Delete only if we still own it.
const RELEASE_SCRIPT =
	"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

function keyFor(sessionId: string): string {
	return `sessionlock:${sessionId}`;
}

export function createRedisSessionLock(redis: Redis): SessionLock {
	const tokens = new Map<string, string>();

	redis.on("error", (err: Error) => {
		log.error({ action: "redis session-lock error", error: String(err) });
	});

	return {
		async acquire(sessionId) {
			const token = randomUUID();
			const res = await redis.set(
				keyFor(sessionId),
				token,
				"PX",
				LOCK_TTL_MS,
				"NX"
			);
			if (res === "OK") {
				tokens.set(sessionId, token);
				return true;
			}
			return false;
		},
		async release(sessionId) {
			const token = tokens.get(sessionId);
			if (token === undefined) {
				return;
			}
			tokens.delete(sessionId);
			await redis.eval(RELEASE_SCRIPT, 1, keyFor(sessionId), token);
		},
	};
}
