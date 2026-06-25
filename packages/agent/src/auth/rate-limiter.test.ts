import { expect, it } from "vitest";
import { createInMemoryRateLimiter } from "./rate-limiter";

const WINDOW = 1000;

it("allows up to the limit then blocks within the window", async () => {
	const rl = createInMemoryRateLimiter(() => 0);
	expect(await rl.hit("k", 2, WINDOW)).toBe(true);
	expect(await rl.hit("k", 2, WINDOW)).toBe(true);
	expect(await rl.hit("k", 2, WINDOW)).toBe(false);
});

it("resets after the window elapses", async () => {
	let clock = 0;
	const rl = createInMemoryRateLimiter(() => clock);
	expect(await rl.hit("k", 1, WINDOW)).toBe(true);
	expect(await rl.hit("k", 1, WINDOW)).toBe(false);
	clock = WINDOW + 1;
	expect(await rl.hit("k", 1, WINDOW)).toBe(true);
});

it("tracks keys independently", async () => {
	const rl = createInMemoryRateLimiter(() => 0);
	expect(await rl.hit("a", 1, WINDOW)).toBe(true);
	expect(await rl.hit("b", 1, WINDOW)).toBe(true);
});
