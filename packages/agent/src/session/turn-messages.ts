import type { ModelMessage } from "ai";
import type { AgentConfig } from "../agent/types";
import type {
	AgentStore,
	AttachmentStore,
	MessageStore,
	ModelCacheStore,
	SessionStore,
} from "../ports";
import { compactSession, type Summarizer } from "./compaction";
import { buildDynamicContext } from "./dynamic-context";
import { type ResolvedImages, toModelMessages } from "./to-model-messages";
import { estimateTokens, exceedsContext } from "./token-estimate";
import type { MessageWithParts, Session } from "./types";

interface BuildTurnMessagesDeps {
	attachmentStore?: AttachmentStore;
	clock?: () => Date;
	messageStore: MessageStore;
	modelCacheStore: ModelCacheStore;
	sessionStore: SessionStore;
	summarizer: Summarizer;
}

/** Fetch bytes for every image `file` part in the history so the model can see
 * them. Non-image files are skipped (stored + shown, but not sent as content). */
async function resolveImages(
	attachmentStore: AttachmentStore | undefined,
	history: MessageWithParts[]
): Promise<ResolvedImages> {
	const images: ResolvedImages = new Map();
	if (!attachmentStore) {
		return images;
	}
	for (const entry of history) {
		for (const part of entry.parts) {
			if (part.type !== "file" || !part.content.mime.startsWith("image/")) {
				continue;
			}
			const bytes = await attachmentStore.getBytes(part.content.attachmentId);
			if (bytes) {
				images.set(part.content.attachmentId, {
					data: bytes,
					mime: part.content.mime,
				});
			}
		}
	}
	return images;
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

async function appendFileParts(
	messageStore: MessageStore,
	attachmentStore: AttachmentStore,
	messageId: string,
	attachmentIds: string[]
): Promise<void> {
	await attachmentStore.linkToMessage(attachmentIds, messageId);
	for (const id of attachmentIds) {
		const att = await attachmentStore.getById(id);
		if (att) {
			await messageStore.appendPart({
				messageId,
				type: "file",
				content: { attachmentId: att.id, mime: att.mime, name: att.name },
				status: "complete",
			});
		}
	}
}

export async function persistUserTurn(input: {
	attachmentIds?: string[];
	attachmentStore?: AttachmentStore;
	messageStore: MessageStore;
	sessionId: string;
	text: string;
}): Promise<void> {
	const { messageStore, attachmentStore, sessionId, text, attachmentIds } =
		input;
	const msg = await messageStore.createMessage({
		sessionId,
		role: "user",
		status: "complete",
		providerId: null,
		modelId: null,
	});
	if (text.length > 0) {
		await messageStore.appendPart({
			messageId: msg.id,
			type: "text",
			content: { text },
			status: "complete",
		});
	}
	if (attachmentStore && attachmentIds && attachmentIds.length > 0) {
		await appendFileParts(messageStore, attachmentStore, msg.id, attachmentIds);
	}
}

export async function buildTurnMessages(
	deps: BuildTurnMessagesDeps,
	agent: AgentConfig,
	session: Session,
	sessionId: string
): Promise<ModelMessage[]> {
	const history = await deps.messageStore.listWithParts(sessionId);
	const now = (deps.clock ?? (() => new Date()))();
	const systemPrompt = `${agent.systemPrompt}\n\n${buildDynamicContext(now)}`;
	const images = await resolveImages(deps.attachmentStore, history);
	const base = {
		systemPrompt,
		summary: session.summary,
		compactedThroughSeq: session.compactedThroughSeq,
		history,
		images,
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
