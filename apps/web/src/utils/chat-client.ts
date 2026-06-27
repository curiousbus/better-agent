import { createUserSessionClientFrom } from "@curiousbus/agent-client/internal";
import { client } from "@/utils/orpc";

export function userAgentClient(agentId: string) {
	return createUserSessionClientFrom(client, agentId);
}
