import { normalizeCodex } from "../normalize/codex";
import type { NormalizedEvent } from "../normalize/types";
import { createAsyncQueue } from "./async-queue";
import { connectJsonRpc } from "./jsonrpc-io";
import type { Adapter, AgentHandle } from "./types";

function threadIdFrom(result: unknown): unknown {
	if (result === null || typeof result !== "object" || !("thread" in result)) {
		return null;
	}
	const thread = (result as { thread: unknown }).thread;
	if (thread === null || typeof thread !== "object" || !("id" in thread)) {
		return null;
	}
	return (thread as { id: unknown }).id;
}

/**
 * `codex app-server` — a long-lived JSON-RPC process, one thread per session.
 *
 * ASSUMPTION (unverified, no `codex` binary available in this sandbox):
 * invoked as `codex app-server` with JSON-RPC over its default stdio
 * transport. Some docs/examples show `codex app-server --listen stdio://`
 * as the explicit form; if the installed codex version requires that flag
 * to select stdio, add it to `CODEX_ARGS` below.
 */
const CODEX_ARGS = ["app-server"];

export const codexAdapter: Adapter = {
	async start(dir: string): Promise<AgentHandle> {
		const rpc = connectJsonRpc("codex", CODEX_ARGS, dir);
		const events = createAsyncQueue<NormalizedEvent>();

		rpc.onNotification((method, params) => {
			for (const event of normalizeCodex({ method, params })) {
				events.push(event);
			}
		});

		await rpc.request("initialize", {
			clientInfo: { name: "better-agent-bridge", version: "0.0.0" },
		});
		rpc.notify("initialized", {});
		const started = await rpc.request("thread/start", { cwd: dir });
		const threadId = threadIdFrom(started);

		return {
			events,
			send(text: string): void {
				rpc
					.request("turn/start", {
						threadId,
						input: [{ type: "text", text }],
					})
					.catch((error: unknown) => {
						events.push({
							kind: "error",
							message: "codex turn/start failed",
							detail: error,
						});
					});
			},
			stop(): void {
				rpc.stop();
				events.close();
			},
		};
	},
};
