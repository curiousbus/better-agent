// Relay data layer for the local agent bridge: pushes live events to a
// connected web client and keeps a short rolling-window replay buffer so a
// client that reconnects (or that was briefly disconnected) can catch up.

/** Which direction an event flows through the bridge. */
export type RelayDir = "events" | "commands";

/** A single relayed item; `id` is monotonic per (sessionId, dir). */
export interface RelayEvent {
	data: unknown;
	id: number;
}

/** Max events retained per (sessionId, dir) for replay. */
export const MAX_WINDOW = 500;
/** TTL (seconds) applied to the Redis-backed replay window. */
export const WINDOW_TTL_SEC = 900;

export interface RelayStore {
	/** Appends `data`, notifies live subscribers, and returns the new id. */
	append(sessionId: string, dir: RelayDir, data: unknown): Promise<number>;
	/** Replays events with id > afterId, in order (fallback for a gap in live push). */
	read(
		sessionId: string,
		dir: RelayDir,
		afterId: number
	): Promise<RelayEvent[]>;
	/**
	 * Live push; returns an unsubscribe function.
	 *
	 * Call subscribe() before read(afterId): append persists to the window
	 * before publishing, so that order guarantees no event is missed
	 * (duplicates across replay+live are possible; dedupe by id).
	 */
	subscribe(
		sessionId: string,
		dir: RelayDir,
		onEvent: (event: RelayEvent) => void
	): () => void;
}

interface RelayChannelState {
	events: RelayEvent[];
	listeners: Set<(event: RelayEvent) => void>;
	seq: number;
}

function keyFor(sessionId: string, dir: RelayDir): string {
	return `${sessionId}:${dir}`;
}

export function createInMemoryRelayStore(): RelayStore {
	const channels = new Map<string, RelayChannelState>();

	function getChannel(sessionId: string, dir: RelayDir): RelayChannelState {
		const key = keyFor(sessionId, dir);
		let channel = channels.get(key);
		if (!channel) {
			channel = { seq: 0, events: [], listeners: new Set() };
			channels.set(key, channel);
		}
		return channel;
	}

	return {
		append(sessionId, dir, data) {
			const channel = getChannel(sessionId, dir);
			channel.seq += 1;
			const event: RelayEvent = { id: channel.seq, data };

			channel.events.push(event);
			if (channel.events.length > MAX_WINDOW) {
				channel.events.splice(0, channel.events.length - MAX_WINDOW);
			}

			for (const listener of channel.listeners) {
				listener(event);
			}

			return Promise.resolve(event.id);
		},

		read(sessionId, dir, afterId) {
			const channel = getChannel(sessionId, dir);
			return Promise.resolve(
				channel.events.filter((event) => event.id > afterId)
			);
		},

		subscribe(sessionId, dir, onEvent) {
			const channel = getChannel(sessionId, dir);
			channel.listeners.add(onEvent);
			return () => {
				channel.listeners.delete(onEvent);
			};
		},
	};
}
