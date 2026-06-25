import { expect, it } from "vitest";
import { createInMemoryCancellationRegistry } from "./cancellation";

it("aborts the registered controller", async () => {
	const reg = createInMemoryCancellationRegistry();
	const c = new AbortController();
	reg.register("s1", c);
	await reg.cancel("s1");
	expect(c.signal.aborted).toBe(true);
});

it("is a no-op after unregister", async () => {
	const reg = createInMemoryCancellationRegistry();
	const c = new AbortController();
	reg.register("s1", c);
	reg.unregister("s1");
	await reg.cancel("s1");
	expect(c.signal.aborted).toBe(false);
});

it("cancel for an unknown session does not throw", async () => {
	const reg = createInMemoryCancellationRegistry();
	await expect(reg.cancel("nope")).resolves.toBeUndefined();
});
