// Polls the server for user commands and dispatches them to the agent. Split
// out of relay-client.ts to keep both files focused (and under the line cap).

import {
	type AfterIdRef,
	type CommandSink,
	dispatchCommands,
	type RelayEvent,
} from "./commands";
import type { StatusEvent } from "./normalize/types";
import type { RelayTransport, Sleep } from "./relay-client";

const DEFAULT_MIN_INTERVAL_MS = 500;
// Idle backoff ceiling. Kept modest (2s, not 5s+) so the first command a user
// types in the web takes at most ~2s to be picked up even after the loop has
// gone idle — the bridge is interactive, not a batch poller.
const DEFAULT_MAX_INTERVAL_MS = 2000;
const BACKOFF_FACTOR = 2;
const STOPPED_BY_SERVER_STATUS = "stopped_by_server";

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PollLoopOptions {
	maxIntervalMs?: number;
	minIntervalMs?: number;
	/** Debug hook: called with each non-empty batch of commands pulled from the
	 * server, so `--debug` can show that input actually reached the agent. */
	onCommands?: (commands: RelayEvent[]) => void;
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

interface PollOnceArgs {
	afterIdRef: AfterIdRef;
	options: PollLoopOptions;
	sessionId: string;
	sink: CommandSink;
	transport: RelayTransport;
}

/** One poll+dispatch cycle: returns whether the loop should stop (a control:stop
 * command landed) and whether this poll delivered any commands (to reset the
 * backoff). Extracted from `pollLoop` to keep that loop's branching simple. */
async function pollOnce(
	args: PollOnceArgs
): Promise<{ stop: boolean; wasActive: boolean }> {
	const { transport, sessionId, sink, afterIdRef, options } = args;
	const commands = await transport.pollCommands({
		sessionId,
		afterId: afterIdRef.current,
	});
	if (commands.length > 0) {
		options.onCommands?.(commands);
	}
	const { wasActive, stopRequested } = dispatchCommands(
		commands,
		sink,
		afterIdRef
	);
	if (stopRequested) {
		await pushStoppedByServerStatus(transport, sessionId);
	}
	return { stop: stopRequested, wasActive };
}

/**
 * Polls `pollCommands(afterId)` in a loop, dispatching each command to `sink` —
 * a text command calls `sink.send`, an approval command calls
 * `sink.answerApproval`. The interval speeds back up to `minIntervalMs` right
 * after an active poll and backs off toward `maxIntervalMs` while idle. A
 * transient transport error is swallowed (reported via `onError`) and retried
 * at `maxIntervalMs`; `afterIdRef` is left untouched so the next successful poll
 * resumes exactly where the last one left off. A `control: stop` command ends
 * the loop immediately after a best-effort final status push.
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
			const { stop, wasActive } = await pollOnce({
				afterIdRef,
				options,
				sessionId,
				sink,
				transport,
			});
			if (stop) {
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
