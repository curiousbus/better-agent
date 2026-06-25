export interface CancellationRegistry {
	/** Abort the in-flight turn for this session (no-op if none on this instance). */
	cancel(sessionId: string): Promise<void>;
	/** Track a live turn's controller so cancel() can abort it. */
	register(sessionId: string, controller: AbortController): void;
	unregister(sessionId: string): void;
}

export function createInMemoryCancellationRegistry(): CancellationRegistry {
	const active = new Map<string, AbortController>();
	return {
		register(sessionId, controller) {
			active.set(sessionId, controller);
		},
		unregister(sessionId) {
			active.delete(sessionId);
		},
		cancel(sessionId) {
			active.get(sessionId)?.abort();
			return Promise.resolve();
		},
	};
}
