import RedisMock from "ioredis-mock";
import { expect, it } from "vitest";
import { createRedisPendingToolCallStore } from "./redis-pending-store";

const ABORT_SETTLE_DELAY_MS = 5;

// ioredis-mock v8 shares a pub/sub bus across all instances created with `new RedisMock()`
// (no `createConnectedClient` needed; two instances suffice to simulate two server processes).

it("park resolves when resolve publishes the result (cross-connection)", async () => {
	const redisA = new RedisMock();
	const redisB = new RedisMock();
	const parker = createRedisPendingToolCallStore(redisA);
	const resolver = createRedisPendingToolCallStore(redisB);

	const parked = parker.park({ sessionId: "s1", callId: "c1" });

	await resolver.resolve({
		sessionId: "s1",
		callId: "c1",
		result: { output: "OK" },
	});
	await expect(parked).resolves.toEqual({ output: "OK" });
});

it("park rejects on abort signal fired after parking", async () => {
	const redis = new RedisMock();
	const store = createRedisPendingToolCallStore(redis);
	const controller = new AbortController();

	const parked = store.park({
		sessionId: "s2",
		callId: "c2",
		abortSignal: controller.signal,
	});

	await new Promise<void>((r) => setTimeout(r, ABORT_SETTLE_DELAY_MS));
	controller.abort();

	await expect(parked).rejects.toThrow("aborted");
});

it("park rejects immediately when abort signal is already aborted", async () => {
	const redis = new RedisMock();
	const store = createRedisPendingToolCallStore(redis);
	const controller = new AbortController();
	controller.abort();

	const parked = store.park({
		sessionId: "s3",
		callId: "c3",
		abortSignal: controller.signal,
	});

	await expect(parked).rejects.toThrow("aborted");
});

it("resolve without a matching park is a no-op (no error thrown)", async () => {
	const redis = new RedisMock();
	const store = createRedisPendingToolCallStore(redis);

	await expect(
		store.resolve({ sessionId: "sx", callId: "cx", result: { output: "X" } })
	).resolves.toBeUndefined();
});
