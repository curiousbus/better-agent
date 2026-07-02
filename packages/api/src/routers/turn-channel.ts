import type { RunEvent } from "@better-agent/agent/session/events";

// Decouples turn execution from the SSE response: a detached pump consumes the
// runtime's events into this channel, and the response merely OBSERVES it. If
// the client disconnects, the observer dies but the pump (kept alive via
// waitUntil) runs the turn to completion — parts keep persisting and finalize
// still runs. Only the cancel endpoint (Stop) aborts a turn early.
export interface TurnChannel {
	close(): void;
	observe(): AsyncGenerator<RunEvent, void>;
	push(event: RunEvent): void;
}

export function createTurnChannel(): TurnChannel {
	const buffer: RunEvent[] = [];
	let closed = false;
	let wake: (() => void) | null = null;
	const notify = () => {
		const resume = wake;
		wake = null;
		resume?.();
	};
	return {
		push(event) {
			if (!closed) {
				buffer.push(event);
				notify();
			}
		},
		close() {
			closed = true;
			notify();
		},
		async *observe() {
			let index = 0;
			while (true) {
				const next = buffer[index];
				if (next !== undefined) {
					index++;
					yield next;
					continue;
				}
				if (closed) {
					return;
				}
				await new Promise<void>((resolve) => {
					wake = resolve;
				});
			}
		},
	};
}

/** Consume the turn fully into the channel; never rejects. */
export async function pumpTurn(
	events: AsyncGenerator<RunEvent, unknown>,
	channel: TurnChannel,
	toErrorEvent: (error: unknown) => RunEvent
): Promise<void> {
	try {
		for await (const event of events) {
			channel.push(event);
		}
	} catch (error) {
		channel.push(toErrorEvent(error));
	} finally {
		channel.close();
	}
}
