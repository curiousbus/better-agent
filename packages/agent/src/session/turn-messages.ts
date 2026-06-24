import type { ModelMessage } from "ai";
import type { AgentConfig } from "../agent/types";
import type {
	AgentStore,
	MessageStore,
	ModelCacheStore,
	SessionStore,
} from "../ports";
import { compactSession, type Summarizer } from "./compaction";
import { toModelMessages } from "./to-model-messages";
import { estimateTokens, exceedsContext } from "./token-estimate";
import type { Session } from "./types";

interface BuildTurnMessagesDeps {
	messageStore: MessageStore;
	modelCacheStore: ModelCacheStore;
	sessionStore: SessionStore;
	summarizer: Summarizer;
}

interface LoadContextDeps {
	agentStore: AgentStore;
	sessionStore: SessionStore;
}

export async function loadContext(
	deps: LoadContextDeps,
	sessionId: string
): Promise<{ session: Session; agent: AgentConfig }> {
	const session = await deps.sessionStore.get(sessionId);
	if (!session) {
		throw new Error(`Session ${sessionId} not found`);
	}
	const agent = await deps.agentStore.get(session.agentId);
	if (!agent) {
		throw new Error(`Agent ${session.agentId} not found`);
	}
	return { session, agent };
}

export async function persistUserTurn(
	messageStore: MessageStore,
	sessionId: string,
	text: string
): Promise<void> {
	const msg = await messageStore.createMessage({
		sessionId,
		role: "user",
		status: "complete",
		providerId: null,
		modelId: null,
	});
	await messageStore.appendPart({
		messageId: msg.id,
		type: "text",
		content: { text },
		status: "complete",
	});
}

export async function buildTurnMessages(
	deps: BuildTurnMessagesDeps,
	agent: AgentConfig,
	session: Session,
	sessionId: string
): Promise<ModelMessage[]> {
	const history = await deps.messageStore.listWithParts(sessionId);
	const base = {
		systemPrompt: agent.systemPrompt,
		summary: session.summary,
		compactedThroughSeq: session.compactedThroughSeq,
		history,
	};
	const messages = toModelMessages(base);
	const modelEntry = await deps.modelCacheStore.get(
		agent.providerId,
		agent.modelId
	);
	const limit = modelEntry?.contextLimit ?? null;
	if (!exceedsContext(estimateTokens(messages), limit)) {
		return messages;
	}
	const compacted = await compactSession(
		{ summarizer: deps.summarizer, sessionStore: deps.sessionStore },
		{ sessionId, agent, session, history }
	);
	if (compacted === null) {
		return messages;
	}
	return toModelMessages({
		...base,
		summary: compacted.summary,
		compactedThroughSeq: compacted.boundary,
	});
}
