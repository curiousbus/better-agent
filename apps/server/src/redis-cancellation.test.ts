import RedisMock from "ioredis-mock";
import { expect, it } from "vitest";
import { createRedisCancellationRegistry } from "./redis-cancellation";

const SETTLE_MS = 10;

it("cancels a controller held on another instance via pubsub", async () => {
	const a = new RedisMock();
	const b = new RedisMock();
	const regA = createRedisCancellationRegistry(a);
	const regB = createRedisCancellationRegistry(b);
	const c = new AbortController();
	regA.register("s1", c);
	await regB.cancel("s1");
	await new Promise<void>((r) => setTimeout(r, SETTLE_MS));
	expect(c.signal.aborted).toBe(true);
});

it("cancel for a session no instance holds is a no-op", async () => {
	const a = new RedisMock();
	const reg = createRedisCancellationRegistry(a);
	await expect(reg.cancel("ghost")).resolves.toBeUndefined();
});
