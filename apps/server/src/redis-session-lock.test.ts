import RedisMock from "ioredis-mock";
import { beforeEach, expect, it } from "vitest";
import { createRedisSessionLock } from "./redis-session-lock";

// ioredis-mock v8 shares a single in-memory store across all instances.
// Flush before each test so lock state does not bleed between tests.
beforeEach(async () => {
	await new RedisMock().flushall();
});

it("grants the lock once and rejects a second holder cross-connection", async () => {
	const a = new RedisMock();
	const b = new RedisMock();
	const lockA = createRedisSessionLock(a);
	const lockB = createRedisSessionLock(b);
	expect(await lockA.acquire("s1")).toBe(true);
	expect(await lockB.acquire("s1")).toBe(false);
});

it("allows re-acquire after release", async () => {
	const redis = new RedisMock();
	const lock = createRedisSessionLock(redis);
	expect(await lock.acquire("s1")).toBe(true);
	await lock.release("s1");
	expect(await lock.acquire("s1")).toBe(true);
});

it("does not block a different session", async () => {
	const redis = new RedisMock();
	const lock = createRedisSessionLock(redis);
	expect(await lock.acquire("s1")).toBe(true);
	expect(await lock.acquire("s2")).toBe(true);
});

it("release only frees a lock this instance still holds (token-guarded)", async () => {
	const a = new RedisMock();
	const b = new RedisMock();
	const lockA = createRedisSessionLock(a);
	const lockB = createRedisSessionLock(b);
	await lockA.acquire("s1");
	// Simulate A's TTL expiring and B taking over:
	await a.del("sessionlock:s1");
	expect(await lockB.acquire("s1")).toBe(true);
	// A's late release must NOT remove B's lock:
	await lockA.release("s1");
	expect(await lockB.acquire("s1")).toBe(false);
});
