import type { PendingToolCallStore } from "@better-agent/agent/tool/pending-store";
import { PENDING_TTL_MS } from "@better-agent/agent/tool/pending-store";
import type { ExecuteResult } from "@better-agent/agent/tool/types";
import type { Redis } from "@upstash/redis";

const POLL_INTERVAL_MS = 250;
const MS_PER_SEC = 1000;
const PENDING_TTL_SEC = Math.ceil(PENDING_TTL_MS / MS_PER_SEC);

function keyFor(sessionId: string, callId: string): string {
	return `toolresult:${sessionId}:${callId}`;
}

function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error("aborted"));
		};
		const timer = setTimeout(() => {
			abortSignal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		abortSignal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Upstash REST pending-tool-call store. `submitToolResult` SETs the result with
 * a TTL; the parked tool call POLLs (GET) until it appears. Coordinates across
 * Cloudflare Worker isolates over HTTP (no pub/sub), unlike the in-memory store
 * whose map is per-isolate and so times out when stream + submit hit different
 * isolates.
 */
export function createUpstashPendingToolCallStore(
	redis: Redis
): PendingToolCallStore {
	return {
		async park({ sessionId, callId, abortSignal }) {
			const key = keyFor(sessionId, callId);
			const start = Date.now();
			let elapsed = 0;
			while (elapsed < PENDING_TTL_MS) {
				if (abortSignal?.aborted) {
					throw new Error(`Tool call ${callId} aborted`);
				}
				const result = await redis.get<ExecuteResult>(key);
				if (result !== null && result !== undefined) {
					await redis.del(key);
					return result;
				}
				await sleep(POLL_INTERVAL_MS, abortSignal);
				elapsed = Date.now() - start;
			}
			throw new Error(`Tool call ${callId} timeout`);
		},
		async resolve({ sessionId, callId, result }) {
			await redis.set(keyFor(sessionId, callId), result, {
				ex: PENDING_TTL_SEC,
			});
		},
	};
}
