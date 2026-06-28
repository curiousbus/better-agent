import type { MessageStore, SessionStore } from "../ports";
import type { ToolDef } from "../tool/types";
import type { RunEvent } from "./events";
import type { DrainCtx } from "./runtime-drain";
import type { Message } from "./types";

export interface AssistantCtx {
	assistant: Message;
	ctx: DrainCtx;
}

/** Create the streaming assistant message + the drain context for a turn. */
export async function buildAssistantCtx(
	messageStore: MessageStore,
	agent: { id: string; providerId: string; modelId: string },
	sessionId: string,
	toolDefs: ToolDef[]
): Promise<AssistantCtx> {
	const assistant = await messageStore.createMessage({
		sessionId,
		role: "assistant",
		status: "streaming",
		providerId: agent.providerId,
		modelId: agent.modelId,
	});
	return {
		assistant,
		ctx: {
			agentId: agent.id,
			assistantId: assistant.id,
			messageStore,
			sessionId,
			toolDefs,
		},
	};
}

/** Await the (background) title and emit a `title` event once it resolves. */
export async function* settleTitleEvent(
	sessionStore: SessionStore,
	sessionId: string,
	titlePromise: Promise<string | null>
): AsyncGenerator<RunEvent, void> {
	const title = await titlePromise;
	if (title) {
		await sessionStore.setTitle(sessionId, title);
		yield { type: "title", title };
	}
}
