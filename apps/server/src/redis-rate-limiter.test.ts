import RedisMock from "ioredis-mock";
import { expect, it } from "vitest";
import { createRedisRateLimiter } from "./redis-rate-limiter";

const WINDOW = 1000;

it("allows up to the limit then blocks", async () => {
	const rl = createRedisRateLimiter(new RedisMock());
	expect(await rl.hit("k", 2, WINDOW)).toBe(true);
	expect(await rl.hit("k", 2, WINDOW)).toBe(true);
	expect(await rl.hit("k", 2, WINDOW)).toBe(false);
});

it("tracks keys independently", async () => {
	const rl = createRedisRateLimiter(new RedisMock());
	expect(await rl.hit("a", 1, WINDOW)).toBe(true);
	expect(await rl.hit("b", 1, WINDOW)).toBe(true);
});
