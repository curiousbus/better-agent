import type { RateLimiter } from "@better-agent/agent/auth/rate-limiter";
import type { Redis } from "ioredis";

export function createRedisRateLimiter(redis: Redis): RateLimiter {
	return {
		async hit(key, limit, windowMs) {
			const count = await redis.incr(`ratelimit:${key}`);
			if (count === 1) {
				await redis.pexpire(`ratelimit:${key}`, windowMs);
			}
			return count <= limit;
		},
	};
}
