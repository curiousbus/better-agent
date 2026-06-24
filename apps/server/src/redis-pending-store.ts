import type { PendingToolCallStore } from "@better-agent/agent/tool/pending-store";
import { PENDING_TTL_MS } from "@better-agent/agent/tool/pending-store";
import type { ExecuteResult } from "@better-agent/agent/tool/types";
import type { Redis } from "ioredis";

function channelFor(sessionId: string, callId: string): string {
	return `toolresult:${sessionId}:${callId}`;
}

function makeParkPromise(
	channel: string,
	callId: string,
	local: Map<string, (result: ExecuteResult) => void>,
	subscriber: Redis,
	abortSignal: AbortSignal | undefined
): Promise<ExecuteResult> {
	return new Promise<ExecuteResult>((resolve, reject) => {
		const cleanup = () => {
			local.delete(channel);
			subscriber.unsubscribe(channel);
		};

		const onAbort = () => {
			clearTimeout(timer);
			cleanup();
			reject(new Error(`Tool call ${callId} aborted`));
		};

		const timer = setTimeout(() => {
			abortSignal?.removeEventListener("abort", onAbort);
			cleanup();
			reject(new Error(`Tool call ${callId} timed out`));
		}, PENDING_TTL_MS);

		const settle = (result: ExecuteResult) => {
			clearTimeout(timer);
			abortSignal?.removeEventListener("abort", onAbort);
			resolve(result);
		};

		local.set(channel, settle);

		abortSignal?.addEventListener("abort", onAbort, { once: true });
	});
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
		async park({ sessionId, callId, abortSignal }) {
			const channel = channelFor(sessionId, callId);

			if (abortSignal?.aborted) {
				return Promise.reject(new Error(`Tool call ${callId} aborted`));
			}

			await subscriber.subscribe(channel);

			return makeParkPromise(channel, callId, local, subscriber, abortSignal);
		},

		async resolve({ sessionId, callId, result }) {
			await redis.publish(
				channelFor(sessionId, callId),
				JSON.stringify(result)
			);
		},
	};
}
