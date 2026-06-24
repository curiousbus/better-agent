import type { ExecuteResult } from "./types";

export const PENDING_TTL_MS = 120_000;

export interface PendingToolCallStore {
	park(input: {
		sessionId: string;
		callId: string;
		abortSignal?: AbortSignal;
	}): Promise<ExecuteResult>;
	resolve(input: {
		sessionId: string;
		callId: string;
		result: ExecuteResult;
	}): Promise<void>;
}

function keyFor(sessionId: string, callId: string): string {
	return `${sessionId}:${callId}`;
}

export function createInMemoryPendingToolCallStore(): PendingToolCallStore {
	const pending = new Map<string, (result: ExecuteResult) => void>();

	return {
		park({ sessionId, callId, abortSignal }) {
			const key = keyFor(sessionId, callId);
			return new Promise<ExecuteResult>((resolve, reject) => {
				const settle = (result: ExecuteResult) => {
					clearTimeout(timer);
					pending.delete(key);
					resolve(result);
				};

				const timer = setTimeout(() => {
					pending.delete(key);
					reject(new Error(`Tool call ${callId} timeout`));
				}, PENDING_TTL_MS);

				pending.set(key, settle);

				abortSignal?.addEventListener("abort", () => {
					clearTimeout(timer);
					pending.delete(key);
					reject(new Error(`Tool call ${callId} aborted`));
				});
			});
		},

		resolve({ sessionId, callId, result }) {
			pending.get(keyFor(sessionId, callId))?.(result);
			return Promise.resolve();
		},
	};
}
