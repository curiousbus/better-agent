// The relay loop: forwards an agent's normalized events to the server in
// batches, and polls the server for user commands to feed back to the agent.
// Both halves are pure functions over an injected `RelayTransport` (and, for
// `forwardEvents`, an injected `sleep`) so they're fully testable without a
// real network or a real timer — see relay-client.test.ts.

import {
	type AfterIdRef,
	type CommandSink,
	dispatchCommands,
	type RelayEvent,
} from "./commands";
import type { StatusEvent } from "./normalize/types";
import { createPushQueue, type PushQueue } from "./push-queue";
import { truncateEvents } from "./truncate-event";

/** The subset of the `bridge:` oRPC router this CLI calls. */
export interface RelayTransport {
	pollCommands(input: {
		afterId: number;
		sessionId: string;
	}): Promise<RelayEvent[]>;
	pushEvents(input: { sessionId: string; events: unknown[] }): Promise<void>;
	startSession(input: {
		agentKind: string;
		label?: string;
	}): Promise<{ sessionId: string }>;
}

export type Sleep = (ms: number) => Promise<void>;

const DEFAULT_MIN_INTERVAL_MS = 500;
const DEFAULT_MAX_INTERVAL_MS = 5000;
const BACKOFF_FACTOR = 2;
const DEFAULT_MAX_BATCH_SIZE = 25;
const DEFAULT_FLUSH_INTERVAL_MS = 250;
// How many events `forwardEvents` will hold in `pushEvents` retry backlog
// before dropping the oldest ones (see push-queue.ts) — generously above
// DEFAULT_MAX_BATCH_SIZE so a handful of consecutive push failures don't
// start shedding events, while still bounding memory during a real outage.
const DEFAULT_MAX_BUFFERED_EVENTS = 1000;
const FLUSH_TICK = Symbol("flush-tick");
/** Status pushed straight to the server (bypassing the normal `forwardEvents`
 * pipeline, which reads from the agent's own event queue) when a `control:
 * stop` command ends the poll loop — see `pushStoppedByServerStatus`. */
const STOPPED_BY_SERVER_STATUS = "stopped_by_server";

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ForwardEventsOptions {
	flushIntervalMs?: number;
	maxBatchSize?: number;
	maxBufferedEvents?: number;
	onWarning?: (message: string) => void;
	/** Sleep implementation for `pushEvents` retry backoff. Defaults to
	 * `sleep` — split out so tests can control the flush-interval timer and
	 * the retry backoff independently (they're unrelated timers that happen
	 * to share a default implementation). */
	pushRetrySleep?: Sleep;
	/** Aborting stops the `pushEvents` retry queue from retrying (or waiting on
	 * more events) promptly, and rejects this call — see push-queue.ts. */
	signal?: AbortSignal;
	/** Sleep implementation for the flush-interval timer. */
	sleep?: Sleep;
}

/** Enqueues `buffer` on `queue` if non-empty, returning the (now-empty) next buffer. */
function flushToQueue<T>(
	buffer: T[],
	queue: { enqueue(batch: T[]): void }
): T[] {
	if (buffer.length === 0) {
		return buffer;
	}
	queue.enqueue(buffer);
	return [];
}

/** Applies `ForwardEventsOptions` defaults and builds the `pushEvents` retry
 * queue. Split out of `forwardEvents` purely to keep that function's
 * cyclomatic complexity low — the defaulting itself has no interesting
 * branching of its own. */
function resolveForwardEventsConfig<T>(
	options: ForwardEventsOptions,
	push: (batch: T[]) => Promise<void>
): {
	flushIntervalMs: number;
	maxBatchSize: number;
	queue: PushQueue<T>;
	sleep: Sleep;
} {
	const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
	const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
	const maxBufferedEvents =
		options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;
	const sleep = options.sleep ?? defaultSleep;
	const pushRetrySleep = options.pushRetrySleep ?? sleep;
	const queue = createPushQueue<T>({
		maxBufferedEvents,
		onWarning: options.onWarning,
		push,
		signal: options.signal,
		sleep: pushRetrySleep,
	});
	return { flushIntervalMs, maxBatchSize, queue, sleep };
}

/**
 * Drains `events` and hands batches off to a `pushEvents` retry queue: either
 * as soon as `maxBatchSize` items are buffered, or after `flushIntervalMs` of
 * no new event (so a slow trickle of events still ships promptly). A batch
 * that fails to push is retried with backoff in the background instead of
 * blocking (or losing) the next batch — see push-queue.ts. Resolves once
 * `events` completes and every batch (including the trailing partial one)
 * has been successfully pushed; rejects immediately if a batch permanently
 * fails to push (see `PushQueue.fatal`) instead of waiting for `events` to
 * complete first.
 */
export async function forwardEvents<T>(
	events: AsyncIterable<T>,
	push: (batch: T[]) => Promise<void>,
	options: ForwardEventsOptions = {}
): Promise<void> {
	const { maxBatchSize, flushIntervalMs, queue, sleep } =
		resolveForwardEventsConfig(options, push);
	const iterator = events[Symbol.asyncIterator]();
	let buffer: T[] = [];

	for (;;) {
		const tick = sleep(flushIntervalMs).then(() => FLUSH_TICK);
		const next = await Promise.race([iterator.next(), tick, queue.fatal]);
		if (next === FLUSH_TICK) {
			buffer = flushToQueue(buffer, queue);
			continue;
		}
		const result = next as IteratorResult<T>;
		if (result.done) {
			break;
		}
		buffer.push(result.value);
		if (buffer.length >= maxBatchSize) {
			buffer = flushToQueue(buffer, queue);
		}
	}
	flushToQueue(buffer, queue);
	await queue.close();
}

export interface PollLoopOptions {
	maxIntervalMs?: number;
	minIntervalMs?: number;
	onError?: (error: unknown) => void;
	signal: AbortSignal;
	sleep?: Sleep;
}

/** Best-effort: pushes a final status event noting the session was stopped
 * remotely, straight to the server (bypassing the agent's own event queue,
 * which `forwardEvents` drains separately) so the web UI's feed gets an
 * explicit last word. Swallows failure — the session is winding down either
 * way, and there's no one left to retry for. */
async function pushStoppedByServerStatus(
	transport: RelayTransport,
	sessionId: string
): Promise<void> {
	try {
		const status: StatusEvent = {
			kind: "status",
			status: STOPPED_BY_SERVER_STATUS,
		};
		await transport.pushEvents({ sessionId, events: [status] });
	} catch {
		// best-effort — nothing else to do here.
	}
}

/**
 * Polls `pollCommands(afterId)` in a loop, dispatching each command to
 * `sink` — a text command calls `sink.send`, an approval command calls
 * `sink.answerApproval`. The interval speeds back up to `minIntervalMs`
 * right after an active poll and backs off toward `maxIntervalMs` while
 * idle. A transient transport error is swallowed (reported via `onError`)
 * and retried at `maxIntervalMs` — `afterIdRef` is left untouched, so the
 * next successful poll resumes exactly where the last one left off.
 *
 * A `control: stop` command (the web UI's "End session" action) ends the
 * loop immediately instead of sleeping and polling again: `dispatchCommands`
 * has already called `sink.stop()`, so this only needs to push a best-effort
 * final status event and return.
 */
export async function pollLoop(
	transport: RelayTransport,
	sessionId: string,
	sink: CommandSink,
	afterIdRef: AfterIdRef,
	options: PollLoopOptions
): Promise<void> {
	const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
	const maxIntervalMs = options.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
	const sleep = options.sleep ?? defaultSleep;
	let interval = minIntervalMs;

	while (!options.signal.aborted) {
		try {
			const commands = await transport.pollCommands({
				sessionId,
				afterId: afterIdRef.current,
			});
			const { wasActive, stopRequested } = dispatchCommands(
				commands,
				sink,
				afterIdRef
			);
			if (stopRequested) {
				await pushStoppedByServerStatus(transport, sessionId);
				return;
			}
			interval = wasActive
				? minIntervalMs
				: Math.min(interval * BACKOFF_FACTOR, maxIntervalMs);
		} catch (error) {
			options.onError?.(error);
			interval = maxIntervalMs;
		}
		if (options.signal.aborted) {
			break;
		}
		await sleep(interval);
	}
}

export interface RunBridgeSessionOptions {
	agentKind: string;
	forwardOptions?: ForwardEventsOptions;
	handle: CommandSink & {
		events: AsyncIterable<unknown>;
		stop(): void;
	};
	label?: string;
	pollOptions?: Omit<PollLoopOptions, "signal">;
	signal: AbortSignal;
	transport: RelayTransport;
}

/**
 * Starts a session, then runs the push and poll loops concurrently until
 * either `signal` aborts (caller asked to stop, e.g. SIGINT) or the agent's
 * event stream completes (the agent process exited) — whichever comes
 * first stops the other loop too, so a natural agent exit doesn't leave the
 * poll loop running forever. `handle.stop()` always runs before this
 * function returns or throws — on any exit path — so a failure here (e.g.
 * `startSession` rejecting) never orphans the spawned agent process.
 */
export async function runBridgeSession(
	options: RunBridgeSessionOptions
): Promise<{ sessionId: string }> {
	try {
		const { sessionId } = await options.transport.startSession({
			agentKind: options.agentKind,
			label: options.label,
		});
		const afterIdRef: AfterIdRef = { current: 0 };
		const pollController = new AbortController();
		const stopPolling = () => pollController.abort();
		options.signal.addEventListener("abort", stopPolling);
		if (options.signal.aborted) {
			stopPolling();
		}

		try {
			await Promise.all([
				forwardEvents(
					truncateEvents(options.handle.events),
					(batch) => options.transport.pushEvents({ sessionId, events: batch }),
					{ ...options.forwardOptions, signal: options.signal }
				).finally(stopPolling),
				pollLoop(options.transport, sessionId, options.handle, afterIdRef, {
					...options.pollOptions,
					signal: pollController.signal,
				}),
			]);
		} finally {
			options.signal.removeEventListener("abort", stopPolling);
		}

		return { sessionId };
	} finally {
		options.handle.stop();
	}
}
