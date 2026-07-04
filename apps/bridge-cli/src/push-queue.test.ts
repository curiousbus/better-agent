import { describe, expect, it, vi } from "vitest";
import { createPushQueue, MAX_PUSH_RETRIES, type Sleep } from "./push-queue";

/** A `sleep` double that resolves immediately — the tests care about retry
 * *ordering* and *counts*, not real backoff timing. */
const instantSleep: Sleep = () => Promise.resolve();

const FAILURES_BEFORE_SUCCESS = 2;
const PERSISTENT_FAILURE_ATTEMPTS = 5;

async function retriesFailingBatchWithoutLosingOrReorderingIt(): Promise<void> {
	const calls: number[][] = [];
	let failuresRemaining = FAILURES_BEFORE_SUCCESS;
	const push = vi.fn((batch: number[]): Promise<void> => {
		calls.push(batch);
		if (failuresRemaining > 0) {
			failuresRemaining -= 1;
			return Promise.reject(new Error("network blip"));
		}
		return Promise.resolve();
	});
	const queue = createPushQueue<number>({
		maxBufferedEvents: 100,
		push,
		sleep: instantSleep,
	});

	queue.enqueue([1, 2]);
	queue.enqueue([3, 4]);
	await queue.close();

	// The first batch was attempted three times (two failures then a
	// success) before the second batch was ever attempted, and both batches
	// were eventually delivered, in order.
	expect(calls).toEqual([
		[1, 2],
		[1, 2],
		[1, 2],
		[3, 4],
	]);
}

async function neverDropsAPersistentlyFailingBatch(): Promise<void> {
	let attempts = 0;
	const push = vi.fn((): Promise<void> => {
		attempts += 1;
		if (attempts < PERSISTENT_FAILURE_ATTEMPTS) {
			return Promise.reject(new Error("still down"));
		}
		return Promise.resolve();
	});
	const onWarning = vi.fn();
	const queue = createPushQueue<number>({
		maxBufferedEvents: 100,
		onWarning,
		push,
		sleep: instantSleep,
	});

	queue.enqueue([1]);
	await queue.close();

	expect(attempts).toBe(PERSISTENT_FAILURE_ATTEMPTS);
	expect(onWarning).toHaveBeenCalled();
}

async function dropsOldestQueuedBatchButNeverAnInFlightOne(): Promise<void> {
	const firstPushStarted = Promise.withResolvers<void>();
	const releaseFirstPush = Promise.withResolvers<void>();
	let pushCalls = 0;
	const push = vi.fn(async (): Promise<void> => {
		pushCalls += 1;
		if (pushCalls === 1) {
			// Block the sender on the very first batch — deterministically
			// signalling once it's actually in flight — so the following
			// enqueues pile up in the backlog instead of being sent.
			firstPushStarted.resolve();
			await releaseFirstPush.promise;
		}
	});
	const onWarning = vi.fn();
	const queue = createPushQueue<number>({
		maxBufferedEvents: 3,
		onWarning,
		push,
		sleep: instantSleep,
	});

	queue.enqueue([1, 2]);
	await firstPushStarted.promise; // [1, 2] is now in flight, out of the backlog

	queue.enqueue([3, 4]); // backlog: 2
	queue.enqueue([5]); // backlog: 3 (== cap, no drop yet)
	queue.enqueue([6]); // backlog: 4 > cap -> drops the oldest, [3, 4]

	expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("dropped 2"));

	releaseFirstPush.resolve();
	await queue.close();

	// [1, 2] (already in flight when the cap was exceeded) was never at
	// risk of being dropped; [3, 4] (still queued) was.
	expect(push).toHaveBeenNthCalledWith(1, [1, 2]);
	expect(push).toHaveBeenNthCalledWith(2, [5]);
	expect(push).toHaveBeenNthCalledWith(3, [6]);
	expect(push).toHaveBeenCalledTimes(3);
}

async function givesUpAfterMaxRetriesAndRejects(): Promise<void> {
	let attempts = 0;
	const push = vi.fn((): Promise<void> => {
		attempts += 1;
		return Promise.reject(new Error("still down"));
	});
	const queue = createPushQueue<number>({
		maxBufferedEvents: 100,
		onWarning: vi.fn(),
		push,
		sleep: instantSleep,
	});

	queue.enqueue([1]);

	const expectedMessage = `push failed after ${MAX_PUSH_RETRIES} attempts`;
	await expect(queue.close()).rejects.toThrow(expectedMessage);
	// `fatal` settles at the same time as (in fact, just before) `close()`,
	// so it's already rejected by the time `close()` is.
	await expect(queue.fatal).rejects.toThrow(expectedMessage);
	expect(attempts).toBe(MAX_PUSH_RETRIES);
}

async function abortMidRetryStopsPromptlyWithoutRejecting(): Promise<void> {
	const controller = new AbortController();
	let attempts = 0;
	const push = vi.fn((): Promise<void> => {
		attempts += 1;
		// Abort right after the first attempt fails — long before
		// MAX_PUSH_RETRIES would otherwise be exhausted.
		controller.abort();
		return Promise.reject(new Error("still down"));
	});
	const queue = createPushQueue<number>({
		maxBufferedEvents: 100,
		push,
		signal: controller.signal,
		sleep: instantSleep,
	});

	queue.enqueue([1]);
	await queue.close(); // resolves — an aborted session isn't a fatal error

	expect(attempts).toBe(1);
}

async function abortBeforeFinalAttemptFailsResolvesWithoutFatalRejection(): Promise<void> {
	const controller = new AbortController();
	let attempts = 0;
	const push = vi.fn((): Promise<void> => {
		attempts += 1;
		if (attempts === MAX_PUSH_RETRIES) {
			// Abort right before the last allowed attempt fails — as if the
			// signal aborted during the backoff sleep leading up to it. The
			// abort check must win over the "out of retries" check, or this
			// gets fatally rejected instead of just stopping quietly.
			controller.abort();
		}
		return Promise.reject(new Error("still down"));
	});
	const queue = createPushQueue<number>({
		maxBufferedEvents: 100,
		onWarning: vi.fn(),
		push,
		signal: controller.signal,
		sleep: instantSleep,
	});

	queue.enqueue([1]);
	await queue.close(); // must resolve — an abort is never a fatal error

	expect(attempts).toBe(MAX_PUSH_RETRIES);
}

describe("createPushQueue", () => {
	it(
		"retries a failing batch with backoff until it succeeds, without losing or reordering it",
		retriesFailingBatchWithoutLosingOrReorderingIt
	);

	it(
		"never drops a batch to a persistent failure — it keeps retrying",
		neverDropsAPersistentlyFailingBatch
	);

	it(
		"drops the oldest *queued* batch under cap pressure, but never one already in flight",
		dropsOldestQueuedBatchButNeverAnInFlightOne
	);

	it(
		`gives up and rejects (via close() and fatal) after ${MAX_PUSH_RETRIES} attempts`,
		givesUpAfterMaxRetriesAndRejects
	);

	it(
		"stops retrying promptly once aborted, without treating it as a fatal error",
		abortMidRetryStopsPromptlyWithoutRejecting
	);

	it(
		`resolves close() without a fatal rejection when aborted right before the ${MAX_PUSH_RETRIES}th attempt fails`,
		abortBeforeFinalAttemptFailsResolvesWithoutFatalRejection
	);
});
