import { expect, it } from "vitest";
import { createInMemorySessionLock } from "./session-lock";

it("grants the lock once and rejects a second holder", async () => {
	const lock = createInMemorySessionLock();
	expect(await lock.acquire("s1")).toBe(true);
	expect(await lock.acquire("s1")).toBe(false);
});

it("does not block a different session", async () => {
	const lock = createInMemorySessionLock();
	expect(await lock.acquire("s1")).toBe(true);
	expect(await lock.acquire("s2")).toBe(true);
});

it("allows re-acquire after release", async () => {
	const lock = createInMemorySessionLock();
	await lock.acquire("s1");
	await lock.release("s1");
	expect(await lock.acquire("s1")).toBe(true);
});
