export interface SessionLock {
	/** Try to take the lock for a session. Returns false if already held. */
	acquire(sessionId: string): boolean;
	release(sessionId: string): void;
}

export class SessionBusyError extends Error {
	constructor(sessionId: string) {
		super(`Session ${sessionId} is already processing a turn`);
		this.name = "SessionBusyError";
	}
}

/**
 * Single-process lock. Multi-instance deployments swap this for a Redis-backed
 * implementation behind the same interface (gap-analysis decision #1).
 */
export function createInMemorySessionLock(): SessionLock {
	const held = new Set<string>();
	return {
		acquire(sessionId) {
			if (held.has(sessionId)) {
				return false;
			}
			held.add(sessionId);
			return true;
		},
		release(sessionId) {
			held.delete(sessionId);
		},
	};
}
