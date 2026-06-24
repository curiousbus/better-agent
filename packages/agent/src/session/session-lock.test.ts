import { expect, it } from "vitest";
import { createInMemorySessionLock } from "./session-lock";

it("grants the lock once and rejects a second holder", () => {
	const lock = createInMemorySessionLock();
	expect(lock.acquire("s1")).toBe(true);
	expect(lock.acquire("s1")).toBe(false);
});

it("does not block a different session", () => {
	const lock = createInMemorySessionLock();
	expect(lock.acquire("s1")).toBe(true);
	expect(lock.acquire("s2")).toBe(true);
});

it("allows re-acquire after release", () => {
	const lock = createInMemorySessionLock();
	lock.acquire("s1");
	lock.release("s1");
	expect(lock.acquire("s1")).toBe(true);
});
