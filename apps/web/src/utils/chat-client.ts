import { createUserSessionClientFrom } from "@better-agent/client";
import { client } from "@/utils/orpc";

export function userAgentClient(agentId: string) {
	return createUserSessionClientFrom(client, agentId);
}
