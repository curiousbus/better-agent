export interface SessionLock {
	/** Try to take the lock for a session. Resolves false if already held. */
	acquire(sessionId: string): Promise<boolean>;
	release(sessionId: string): Promise<void>;
}

export class SessionBusyError extends Error {
	constructor(sessionId: string) {
		super(`Session ${sessionId} is already processing a turn`);
		this.name = "SessionBusyError";
	}
}

/**
 * Single-process lock. Multi-instance deployments swap this for a Redis-backed
 * implementation behind the same interface; see apps/server/redis-session-lock.ts.
 */
export function createInMemorySessionLock(): SessionLock {
	const held = new Set<string>();
	return {
		acquire(sessionId) {
			if (held.has(sessionId)) {
				return Promise.resolve(false);
			}
			held.add(sessionId);
			return Promise.resolve(true);
		},
		release(sessionId) {
			held.delete(sessionId);
			return Promise.resolve();
		},
	};
}
