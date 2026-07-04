import { normalizeOpencode } from "../normalize/opencode";
import type { NormalizedEvent } from "../normalize/types";
import { createAsyncQueue } from "./async-queue";
import { connectJsonRpc } from "./jsonrpc-io";
import type { Adapter, AgentHandle } from "./types";

/** `opencode acp` — the Agent Client Protocol server built into opencode. */
export const opencodeAdapter: Adapter = {
	async start(dir: string): Promise<AgentHandle> {
		const rpc = connectJsonRpc("opencode", ["acp"], dir);
		const events = createAsyncQueue<NormalizedEvent>();

		rpc.onNotification((method, params) => {
			for (const event of normalizeOpencode({ method, params })) {
				events.push(event);
			}
		});

		await rpc.request("initialize", { protocolVersion: 1 });
		const session = await rpc.request("session/new", {
			cwd: dir,
			mcpServers: [],
		});
		const sessionId =
			session !== null && typeof session === "object" && "sessionId" in session
				? (session as { sessionId: unknown }).sessionId
				: undefined;

		return {
			events,
			send(text: string): void {
				rpc
					.request("session/prompt", {
						sessionId,
						prompt: [{ type: "text", text }],
					})
					.catch((error: unknown) => {
						events.push({
							kind: "error",
							message: "opencode session/prompt failed",
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
