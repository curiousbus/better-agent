import { describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "./adapters/async-queue";
import {
	forwardEvents,
	parseCommandText,
	pollLoop,
	type RelayTransport,
	runBridgeSession,
	type Sleep,
} from "./relay-client";

async function* arrayEvents<T>(values: T[]): AsyncGenerator<T> {
	await Promise.resolve();
	for (const value of values) {
		yield value;
	}
}

/** A `sleep` double whose promise only resolves when the test calls `resolve()`. */
function createControllableSleep() {
	const resolvers: Array<() => void> = [];
	const sleep: Sleep = (_ms) =>
		new Promise<void>((resolve) => {
			resolvers.push(resolve);
		});
	return { sleep, resolveCall: (index: number) => resolvers[index]?.() };
}

describe("forwardEvents", () => {
	it("flushes as soon as maxBatchSize is reached, then the trailing partial batch", async () => {
		const push = vi.fn().mockResolvedValue(undefined);
		// A sleep that never resolves: no timer-based flush should occur, only
		// size-triggered ones plus the final trailing flush after completion.
		const neverSleep: Sleep = () => new Promise(() => undefined);

		await forwardEvents(arrayEvents([1, 2, 3, 4, 5]), push, {
			maxBatchSize: 2,
			sleep: neverSleep,
		});

		expect(push.mock.calls).toEqual([[[1, 2]], [[3, 4]], [[5]]]);
	});

	it("flushes a partial batch once the flush interval elapses", async () => {
		const push = vi.fn().mockResolvedValue(undefined);
		const queue = createAsyncQueue<string>();
		const { sleep, resolveCall } = createControllableSleep();

		const done = forwardEvents(queue, push, { maxBatchSize: 100, sleep });

		queue.push("a");
		// Give the event loop a turn so "a" lands in the buffer ahead of the
		// (still-pending) flush timer for this iteration.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(push).not.toHaveBeenCalled();

		resolveCall(1); // fires the flush timer created for the *next* iteration
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(push).toHaveBeenCalledWith(["a"]);

		queue.close();
		await done;
	});
});

describe("parseCommandText", () => {
	it("accepts a bare string", () => {
		expect(parseCommandText("go")).toBe("go");
	});

	it("accepts an object with a text field", () => {
		expect(parseCommandText({ text: "go" })).toBe("go");
	});

	it("rejects anything else", () => {
		expect(parseCommandText(42)).toBeNull();
		expect(parseCommandText(null)).toBeNull();
		expect(parseCommandText({ other: "go" })).toBeNull();
	});
});

function fakeTransport(
	pollCommands: RelayTransport["pollCommands"]
): RelayTransport {
	return {
		startSession: vi.fn().mockResolvedValue({ sessionId: "sess_1" }),
		pushEvents: vi.fn().mockResolvedValue(undefined),
		pollCommands,
	};
}

const ABORT_AFTER_SLEEPS = 3;

/** A `sleep` double that records each requested interval and aborts `controller` on the Nth call. */
function createAbortingSleep(
	controller: AbortController,
	sleepCalls: number[]
): Sleep {
	return (ms) => {
		sleepCalls.push(ms);
		if (sleepCalls.length >= ABORT_AFTER_SLEEPS) {
			controller.abort();
		}
		return Promise.resolve();
	};
}

describe("pollLoop - happy path", () => {
	it("dispatches commands, advances afterId, and adapts the interval", async () => {
		const controller = new AbortController();
		const pollCommands = vi
			.fn()
			.mockResolvedValueOnce([{ id: 1, data: "do the thing" }])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);
		const transport = fakeTransport(pollCommands);
		const send = vi.fn();
		const sleepCalls: number[] = [];
		const afterIdRef = { current: 0 };

		await pollLoop(transport, "sess_1", send, afterIdRef, {
			signal: controller.signal,
			sleep: createAbortingSleep(controller, sleepCalls),
		});

		expect(pollCommands).toHaveBeenCalledTimes(3);
		expect(pollCommands).toHaveBeenNthCalledWith(1, {
			sessionId: "sess_1",
			afterId: 0,
		});
		expect(pollCommands).toHaveBeenNthCalledWith(2, {
			sessionId: "sess_1",
			afterId: 1,
		});
		expect(send).toHaveBeenCalledExactlyOnceWith("do the thing");
		expect(afterIdRef.current).toBe(1);
		// active poll -> fast; then backs off while idle.
		expect(sleepCalls).toEqual([500, 1000, 2000]);
	});
});

describe("pollLoop - reconnect", () => {
	it("resumes afterId across a transient transport failure", async () => {
		const controller = new AbortController();
		const pollCommands = vi
			.fn()
			.mockResolvedValueOnce([{ id: 5, data: "a" }])
			.mockRejectedValueOnce(new Error("network blip"))
			.mockResolvedValueOnce([]);
		const transport = fakeTransport(pollCommands);
		const onError = vi.fn();
		const sleepCalls: number[] = [];
		const afterIdRef = { current: 0 };

		await pollLoop(transport, "sess_1", vi.fn(), afterIdRef, {
			signal: controller.signal,
			sleep: createAbortingSleep(controller, sleepCalls),
			onError,
		});

		expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
		// The failed poll never advanced afterId, so the retry (and the poll
		// after it) both resume from the id the last *successful* poll saw.
		expect(pollCommands).toHaveBeenNthCalledWith(2, {
			sessionId: "sess_1",
			afterId: 5,
		});
		expect(pollCommands).toHaveBeenNthCalledWith(3, {
			sessionId: "sess_1",
			afterId: 5,
		});
		expect(afterIdRef.current).toBe(5);
	});
});

async function startsSessionPushesEventsAndPollsUnderOneSessionId(): Promise<void> {
	const controller = new AbortController();
	const transport = fakeTransport(vi.fn().mockResolvedValue([]));
	const send = vi.fn();
	const stop = vi.fn();
	const sleep: Sleep = () => {
		controller.abort();
		return Promise.resolve();
	};

	const result = await runBridgeSession({
		agentKind: "claude-code",
		label: "my project",
		transport,
		handle: { events: arrayEvents(["e1", "e2"]), send, stop },
		signal: controller.signal,
		pollOptions: { sleep },
	});

	expect(result).toEqual({ sessionId: "sess_1" });
	expect(transport.startSession).toHaveBeenCalledExactlyOnceWith({
		agentKind: "claude-code",
		label: "my project",
	});
	expect(transport.pushEvents).toHaveBeenCalledWith({
		sessionId: "sess_1",
		events: ["e1", "e2"],
	});
	// The agent process must be released once the session winds down,
	// whether that's a clean finish or a failure below.
	expect(stop).toHaveBeenCalledTimes(1);
}

async function stopsTheAgentEvenWhenStartingTheSessionFailsOutright(): Promise<void> {
	const controller = new AbortController();
	const transport = fakeTransport(vi.fn().mockResolvedValue([]));
	transport.startSession = vi
		.fn()
		.mockRejectedValue(new Error("server unreachable"));
	const stop = vi.fn();

	await expect(
		runBridgeSession({
			agentKind: "claude-code",
			label: "my project",
			transport,
			handle: { events: arrayEvents([]), send: vi.fn(), stop },
			signal: controller.signal,
		})
	).rejects.toThrow("server unreachable");

	expect(stop).toHaveBeenCalledTimes(1);
}

const FORWARD_TEST_MAX_BATCH_SIZE = 100;

async function retriesAFailedPushEventsBatchInsteadOfDroppingIt(): Promise<void> {
	const controller = new AbortController();
	const pushedBatches: number[][] = [];
	let failuresRemaining = 1;
	const pushEvents = vi.fn(
		async (input: { events: unknown[] }): Promise<void> => {
			await Promise.resolve();
			if (failuresRemaining > 0) {
				failuresRemaining -= 1;
				throw new Error("network blip");
			}
			pushedBatches.push(input.events as number[]);
		}
	);
	const transport = fakeTransport(vi.fn().mockResolvedValue([]));
	transport.pushEvents = pushEvents;
	const stop = vi.fn();
	// The flush-interval timer never fires (so the only batch is the
	// trailing one, once the events complete); the retry backoff resolves
	// immediately so the test doesn't wait on real timers.
	const neverSleep: Sleep = () => new Promise(() => undefined);

	await runBridgeSession({
		agentKind: "claude-code",
		transport,
		handle: { events: arrayEvents([1, 2, 3]), send: vi.fn(), stop },
		signal: controller.signal,
		forwardOptions: {
			maxBatchSize: FORWARD_TEST_MAX_BATCH_SIZE,
			sleep: neverSleep,
			pushRetrySleep: () => Promise.resolve(),
		},
		pollOptions: { sleep: () => Promise.resolve() },
	});

	// First attempt failed and was never counted as delivered; the retry
	// carried the exact same batch through, in order, exactly once.
	expect(pushedBatches).toEqual([[1, 2, 3]]);
	expect(pushEvents).toHaveBeenCalledTimes(2);
	expect(stop).toHaveBeenCalledTimes(1);
}

describe("runBridgeSession", () => {
	it(
		"starts a session, pushes events, and polls under one sessionId",
		startsSessionPushesEventsAndPollsUnderOneSessionId
	);

	it(
		"stops the agent even when starting the session fails outright",
		stopsTheAgentEvenWhenStartingTheSessionFailsOutright
	);

	it(
		"retries a failed pushEvents batch instead of dropping it, preserving order",
		retriesAFailedPushEventsBatchInsteadOfDroppingIt
	);
});
