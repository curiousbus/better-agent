// A bounded, order-preserving retry queue for shipping batches to the relay
// server. `enqueue` never blocks the producer (`forwardEvents`'s pull loop):
// a background sender drains the queue one batch at a time, retrying a
// failed batch with backoff (mirroring `pollLoop`'s shape) until it succeeds
// before moving on to the next one. That means a transient outage neither
// stalls event collection nor drops events — it just backs the queue up,
// which is why the queue is capped: past `maxBufferedEvents`, the oldest
// queued batch is dropped (and reported via `onWarning`) instead of growing
// without bound.

export type Sleep = (ms: number) => Promise<void>;

const PUSH_RETRY_MIN_INTERVAL_MS = 500;
const PUSH_RETRY_MAX_INTERVAL_MS = 5000;
const PUSH_RETRY_BACKOFF_FACTOR = 2;

export interface PushQueueOptions<T> {
	maxBufferedEvents: number;
	onWarning?: (message: string) => void;
	push: (batch: T[]) => Promise<void>;
	sleep?: Sleep;
}

export interface PushQueue<T> {
	/** Signals that no more batches will be enqueued, and resolves once every
	 * already-enqueued batch has been successfully pushed. */
	close(): Promise<void>;
	/** Enqueues a batch for sending. Never rejects and never blocks. */
	enqueue(batch: T[]): void;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function bufferedCount<T>(pending: T[][]): number {
	let total = 0;
	for (const batch of pending) {
		total += batch.length;
	}
	return total;
}

/** Drops whole batches from the front of `pending` until it's back within
 * `maxBufferedEvents` (never dropping the sole remaining batch, so a single
 * over-sized batch doesn't get discarded outright). */
function enforceCap<T>(
	pending: T[][],
	maxBufferedEvents: number,
	onWarning?: (message: string) => void
): void {
	let dropped = 0;
	while (bufferedCount(pending) > maxBufferedEvents && pending.length > 1) {
		dropped += pending.shift()?.length ?? 0;
	}
	if (dropped > 0) {
		onWarning?.(
			`bridge: dropped ${dropped} buffered event(s) — push backlog exceeded ${maxBufferedEvents}`
		);
	}
}

/** Pushes `batch`, retrying with backoff until it succeeds. Never gives up:
 * a persistent outage is the caller's problem to notice via `onWarning`, not
 * a reason to drop events that were already collected. */
async function pushWithRetry<T>(
	batch: T[],
	push: (batch: T[]) => Promise<void>,
	sleep: Sleep,
	onWarning?: (message: string) => void
): Promise<void> {
	let intervalMs = PUSH_RETRY_MIN_INTERVAL_MS;
	for (;;) {
		try {
			await push(batch);
			return;
		} catch (error) {
			onWarning?.(
				`bridge: push failed, retrying in ${intervalMs}ms: ${String(error)}`
			);
			await sleep(intervalMs);
			intervalMs = Math.min(
				intervalMs * PUSH_RETRY_BACKOFF_FACTOR,
				PUSH_RETRY_MAX_INTERVAL_MS
			);
		}
	}
}

export function createPushQueue<T>(options: PushQueueOptions<T>): PushQueue<T> {
	const pending: T[][] = [];
	const sleep = options.sleep ?? defaultSleep;
	let wake: (() => void) | null = null;
	let closed = false;

	function wakeSender(): void {
		if (wake) {
			const resolve = wake;
			wake = null;
			resolve();
		}
	}

	const finished = (async () => {
		for (;;) {
			// Dequeueing before pushing (rather than peeking) is deliberate: once
			// a batch is picked up, it's "in flight" and must never be visible
			// to `enforceCap` — only the not-yet-attempted backlog is droppable.
			const batch = pending.shift();
			if (!batch) {
				if (closed) {
					return;
				}
				await new Promise<void>((resolve) => {
					wake = resolve;
				});
				continue;
			}
			await pushWithRetry(batch, options.push, sleep, options.onWarning);
		}
	})();

	return {
		enqueue(batch: T[]): void {
			pending.push(batch);
			enforceCap(pending, options.maxBufferedEvents, options.onWarning);
			wakeSender();
		},
		close(): Promise<void> {
			closed = true;
			wakeSender();
			return finished;
		},
	};
}
