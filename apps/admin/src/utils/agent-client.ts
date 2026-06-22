import type { AgentClient } from "@better-agent/client";
import { createAgentClient } from "@better-agent/client";
import { env } from "@better-agent/env/web";

import { loadAgentToken } from "@/utils/agent-token";

/**
 * Build a token-scoped Agent SDK client for the given agent from the cached
 * one-time token. Returns null when no token is cached (e.g. on the server, or
 * before the agent's token has been generated) so callers can prompt for one.
 */
export function getAgentClient(agentId: string): AgentClient | null {
	const token = loadAgentToken(agentId);
	if (!token) {
		return null;
	}
	return createAgentClient({ baseURL: env.VITE_SERVER_URL, token });
}
