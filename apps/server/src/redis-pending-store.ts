import type { PendingToolCallStore } from "@better-agent/agent/tool/pending-store";
import { PENDING_TTL_MS } from "@better-agent/agent/tool/pending-store";
import type { ExecuteResult } from "@better-agent/agent/tool/types";
import type { Redis } from "ioredis";

function channelFor(sessionId: string, callId: string): string {
	return `toolresult:${sessionId}:${callId}`;
}

export function createRedisPendingToolCallStore(
	redis: Redis
): PendingToolCallStore {
	const subscriber = redis.duplicate();
	const local = new Map<string, (result: ExecuteResult) => void>();

	subscriber.on("message", (channel: string, payload: string) => {
		const settle = local.get(channel);
		if (settle) {
			local.delete(channel);
			subscriber.unsubscribe(channel);
			settle(JSON.parse(payload) as ExecuteResult);
		}
	});

	return {
		park({ sessionId, callId, abortSignal }) {
			const channel = channelFor(sessionId, callId);

			if (abortSignal?.aborted) {
				return Promise.reject(new Error(`Tool call ${callId} aborted`));
			}

			return new Promise<ExecuteResult>((resolve, reject) => {
				const cleanup = () => {
					local.delete(channel);
					subscriber.unsubscribe(channel);
				};

				const timer = setTimeout(() => {
					cleanup();
					reject(new Error(`Tool call ${callId} timed out`));
				}, PENDING_TTL_MS);

				const settle = (result: ExecuteResult) => {
					clearTimeout(timer);
					resolve(result);
				};

				local.set(channel, settle);
				subscriber.subscribe(channel);

				const onAbort = () => {
					clearTimeout(timer);
					cleanup();
					reject(new Error(`Tool call ${callId} aborted`));
				};

				abortSignal?.addEventListener("abort", onAbort, { once: true });
			});
		},

		async resolve({ sessionId, callId, result }) {
			await redis.publish(
				channelFor(sessionId, callId),
				JSON.stringify(result)
			);
		},
	};
}
