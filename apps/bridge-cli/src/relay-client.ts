// The relay loop: forwards an agent's normalized events to the server in
// batches, and polls the server for user commands to feed back to the agent.
// Both halves are pure functions over an injected `RelayTransport` (and, for
// `forwardEvents`, an injected `sleep`) so they're fully testable without a
// real network or a real timer — see relay-client.test.ts.

/** One relayed command/event; mirrors `RelayEvent` from `@better-agent/agent/ports`. */
export interface RelayEvent {
	data: unknown;
	id: number;
}

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
const FLUSH_TICK = Symbol("flush-tick");

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ForwardEventsOptions {
	flushIntervalMs?: number;
	maxBatchSize?: number;
	sleep?: Sleep;
}

/** Pushes `buffer` if non-empty, returning the (now-empty) next buffer. */
async function flushBuffer<T>(
	buffer: T[],
	push: (batch: T[]) => Promise<void>
): Promise<T[]> {
	if (buffer.length === 0) {
		return buffer;
	}
	await push(buffer);
	return [];
}

/**
 * Drains `events` and calls `push` with batches: either as soon as
 * `maxBatchSize` items are buffered, or after `flushIntervalMs` of no new
 * event (so a slow trickle of events still ships promptly). Resolves once
 * `events` completes and any trailing partial batch has been pushed.
 */
export async function forwardEvents<T>(
	events: AsyncIterable<T>,
	push: (batch: T[]) => Promise<void>,
	options: ForwardEventsOptions = {}
): Promise<void> {
	const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
	const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
	const sleep = options.sleep ?? defaultSleep;
	const iterator = events[Symbol.asyncIterator]();
	let buffer: T[] = [];

	for (;;) {
		const tick = sleep(flushIntervalMs).then(() => FLUSH_TICK);
		const next = await Promise.race([iterator.next(), tick]);
		if (next === FLUSH_TICK) {
			buffer = await flushBuffer(buffer, push);
			continue;
		}
		const result = next as IteratorResult<T>;
		if (result.done) {
			break;
		}
		buffer.push(result.value);
		if (buffer.length >= maxBatchSize) {
			buffer = await flushBuffer(buffer, push);
		}
	}
	await flushBuffer(buffer, push);
}

/** Extracts the text of a relayed command. `sendInput`'s `data` is `unknown`
 * on the wire, so this accepts either a bare string or `{ text: string }`. */
export function parseCommandText(data: unknown): string | null {
	if (typeof data === "string") {
		return data;
	}
	if (
		data !== null &&
		typeof data === "object" &&
		"text" in data &&
		typeof (data as { text: unknown }).text === "string"
	) {
		return (data as { text: string }).text;
	}
	return null;
}

/** Mutable so pollLoop can resume from the last seen id after a reconnect. */
export interface AfterIdRef {
	current: number;
}

export interface PollLoopOptions {
	maxIntervalMs?: number;
	minIntervalMs?: number;
	onError?: (error: unknown) => void;
	signal: AbortSignal;
	sleep?: Sleep;
}

function dispatchCommands(
	commands: RelayEvent[],
	send: (text: string) => void,
	afterIdRef: AfterIdRef
): boolean {
	for (const command of commands) {
		const text = parseCommandText(command.data);
		if (text !== null) {
			send(text);
		}
		afterIdRef.current = command.id;
	}
	return commands.length > 0;
}

/**
 * Polls `pollCommands(afterId)` in a loop, dispatching each command's text to
 * `send`. The interval speeds back up to `minIntervalMs` right after an
 * active poll and backs off toward `maxIntervalMs` while idle. A transient
 * transport error is swallowed (reported via `onError`) and retried at
 * `maxIntervalMs` — `afterIdRef` is left untouched, so the next successful
 * poll resumes exactly where the last one left off.
 */
export async function pollLoop(
	transport: RelayTransport,
	sessionId: string,
	send: (text: string) => void,
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
			const wasActive = dispatchCommands(commands, send, afterIdRef);
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
	handle: { events: AsyncIterable<unknown>; send(text: string): void };
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
 * poll loop running forever.
 */
export async function runBridgeSession(
	options: RunBridgeSessionOptions
): Promise<{ sessionId: string }> {
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
				options.handle.events,
				(batch) => options.transport.pushEvents({ sessionId, events: batch }),
				options.forwardOptions
			).finally(stopPolling),
			pollLoop(options.transport, sessionId, options.handle.send, afterIdRef, {
				...options.pollOptions,
				signal: pollController.signal,
			}),
		]);
	} finally {
		options.signal.removeEventListener("abort", stopPolling);
	}

	return { sessionId };
}
