import { expect, it, vi } from "vitest";
import { createInMemoryPendingToolCallStore } from "./pending-store";

const ABORT_RE = /abort/i;
const TIMEOUT_RE = /timeout/i;

it("park resolves when resolve is called for the same call", async () => {
	const store = createInMemoryPendingToolCallStore();
	const parked = store.park({ sessionId: "s1", callId: "c1" });
	await store.resolve({
		sessionId: "s1",
		callId: "c1",
		result: { output: "OK" },
	});
	await expect(parked).resolves.toEqual({ output: "OK" });
});

it("resolve for an unknown call is a no-op", async () => {
	const store = createInMemoryPendingToolCallStore();
	await expect(
		store.resolve({ sessionId: "s1", callId: "nope", result: { output: "x" } })
	).resolves.toBeUndefined();
});

it("park rejects on abort", async () => {
	const store = createInMemoryPendingToolCallStore();
	const ac = new AbortController();
	const parked = store.park({
		sessionId: "s1",
		callId: "c1",
		abortSignal: ac.signal,
	});
	ac.abort();
	await expect(parked).rejects.toThrow(ABORT_RE);
});

it("park rejects immediately when the signal is already aborted", async () => {
	const store = createInMemoryPendingToolCallStore();
	const ac = new AbortController();
	ac.abort();
	await expect(
		store.park({ sessionId: "s1", callId: "c1", abortSignal: ac.signal })
	).rejects.toThrow(ABORT_RE);
});

it("park rejects after the TTL", async () => {
	vi.useFakeTimers();
	const store = createInMemoryPendingToolCallStore();
	const parked = store.park({ sessionId: "s1", callId: "c1" });
	const assertion = expect(parked).rejects.toThrow(TIMEOUT_RE);
	await vi.advanceTimersByTimeAsync(120_001);
	await assertion;
	vi.useRealTimers();
});
