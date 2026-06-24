import { computeCost } from "../provider/cost";
import type { RunEvent } from "./events";
import type { StreamOutcome } from "./retry-helpers";
import type { SessionRuntimeDeps } from "./runtime";
import type { Message, MessageUsage } from "./types";

export interface AgentIdentity {
	modelId: string;
	providerId: string;
}

async function withCost(
	deps: Pick<SessionRuntimeDeps, "modelCacheStore">,
	agent: AgentIdentity,
	usage: MessageUsage | null
): Promise<MessageUsage | null> {
	if (usage === null) {
		return null;
	}
	const entry = await deps.modelCacheStore.get(agent.providerId, agent.modelId);
	return { ...usage, costCents: entry ? computeCost(usage, entry) : null };
}

export interface FinalizeArgs {
	agent: AgentIdentity;
	assistantId: string;
	fallback: Message;
	outcome: StreamOutcome;
	sessionId: string;
}

export async function* finalizeAssistant(
	deps: Pick<
		SessionRuntimeDeps,
		"messageStore" | "modelCacheStore" | "sessionStore"
	>,
	args: FinalizeArgs
): AsyncGenerator<RunEvent, Message> {
	const { agent, assistantId, fallback, sessionId, outcome } = args;
	const usage = await withCost(deps, agent, outcome.usage);
	const final = await deps.messageStore.updateMessage(assistantId, {
		status: outcome.status,
		usage,
		finishReason: outcome.finishReason,
		error: outcome.errorMessage
			? {
					message: outcome.errorMessage,
					category: outcome.errorCategory ?? "fatal",
				}
			: null,
	});
	if (outcome.status === "error") {
		await deps.sessionStore.setStatus(sessionId, "error");
		yield { type: "error", message: outcome.errorMessage ?? "stream error" };
	} else {
		yield {
			type: "done",
			usage,
			finishReason: outcome.finishReason,
			structured: outcome.structured,
		};
	}
	return final ?? fallback;
}
