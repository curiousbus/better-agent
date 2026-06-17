import type { ModelMessage } from "ai";
import { stepCountIs, streamText } from "ai";
import type { AgentConfig, AgentParams } from "../agent/types";
import type { AgentStore, MessageStore, SessionStore } from "../ports";
import type { ModelFactory } from "../provider/model-factory";
import type { RunEvent } from "./events";
import { mapFinishReason, mapUsage } from "./stream-mapping";
import { toModelMessages } from "./to-model-messages";
import type {
	FinishReason,
	Message,
	MessageUsage,
	PartStatus,
	Session,
} from "./types";

const MAX_STEPS = 1; // P1 无工具；工具阶段（P2）再调高

export interface SessionRuntimeDeps {
	agentStore: AgentStore;
	messageStore: MessageStore;
	modelFactory: ModelFactory;
	sessionStore: SessionStore;
}

export interface RunTurnInput {
	abortSignal?: AbortSignal;
	sessionId: string;
	text: string;
}

export interface SessionRuntime {
	runTurn(input: RunTurnInput): AsyncGenerator<RunEvent, Message>;
}

type StreamStatus = "complete" | "error" | "aborted";
type AiModel = Awaited<ReturnType<ModelFactory["create"]>>;
type PartBuf = ReturnType<typeof createPartBuffer>;

interface StreamOutcome {
	errorMessage: string | null;
	finishReason: FinishReason;
	status: StreamStatus;
	usage: MessageUsage | null;
}

function errorToMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function buildSettings(params: AgentParams | null) {
	const settings: {
		temperature?: number;
		topP?: number;
		maxOutputTokens?: number;
	} = {};
	if (params?.temperature != null) {
		settings.temperature = params.temperature;
	}
	if (params?.topP != null) {
		settings.topP = params.topP;
	}
	if (params?.maxOutputTokens != null) {
		settings.maxOutputTokens = params.maxOutputTokens;
	}
	return settings;
}

/** 累積一類 part 的文本，結束時一次性落庫（spec §8「finish 時落庫」）。 */
function createPartBuffer(
	messageStore: MessageStore,
	messageId: string,
	type: "text" | "reasoning"
) {
	let buf = "";
	return {
		append(delta: string) {
			buf += delta;
		},
		async flush(status: PartStatus): Promise<void> {
			if (buf.length > 0) {
				await messageStore.appendPart({
					messageId,
					type,
					content: { text: buf },
					status,
				});
			}
		},
	};
}

async function loadContext(
	deps: SessionRuntimeDeps,
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

async function persistUserTurn(
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

async function* drainStream(
	result: ReturnType<typeof streamText>,
	textBuf: PartBuf,
	reasoningBuf: PartBuf,
	state: StreamOutcome
): AsyncGenerator<RunEvent, void> {
	for await (const chunk of result.fullStream) {
		if (chunk.type === "text-delta") {
			textBuf.append(chunk.text);
			yield { type: "text-delta", delta: chunk.text };
		} else if (chunk.type === "reasoning-delta") {
			reasoningBuf.append(chunk.text);
			yield { type: "reasoning-delta", delta: chunk.text };
		} else if (chunk.type === "finish-step") {
			yield { type: "step-finish" };
		} else if (chunk.type === "finish") {
			state.usage = mapUsage(chunk.totalUsage);
			state.finishReason = mapFinishReason(chunk.finishReason);
		} else if (chunk.type === "error") {
			state.status = "error";
			state.finishReason = "error";
			state.errorMessage = errorToMessage(chunk.error);
		} else if (chunk.type === "abort") {
			state.status = "aborted";
		}
	}
}

async function* streamAssistant(
	deps: SessionRuntimeDeps,
	model: AiModel,
	messages: ModelMessage[],
	params: AgentParams | null,
	assistantId: string,
	abortSignal?: AbortSignal
): AsyncGenerator<RunEvent, StreamOutcome> {
	const textBuf = createPartBuffer(deps.messageStore, assistantId, "text");
	const reasoningBuf = createPartBuffer(
		deps.messageStore,
		assistantId,
		"reasoning"
	);
	const state: StreamOutcome = {
		usage: null,
		finishReason: "stop",
		status: "complete",
		errorMessage: null,
	};
	try {
		const result = streamText({
			model,
			messages,
			stopWhen: stepCountIs(MAX_STEPS),
			tools: {},
			abortSignal,
			...buildSettings(params),
		});
		yield* drainStream(result, textBuf, reasoningBuf, state);
	} catch (error) {
		if (abortSignal?.aborted) {
			state.status = "aborted";
		} else {
			state.status = "error";
			state.finishReason = "error";
			state.errorMessage = errorToMessage(error);
		}
	} finally {
		const partStatus: PartStatus =
			state.status === "error" ? "error" : "complete";
		await reasoningBuf.flush(partStatus);
		await textBuf.flush(partStatus);
	}
	return state;
}

async function* finalizeAssistant(
	deps: SessionRuntimeDeps,
	assistantId: string,
	assistantFallback: Message,
	sessionId: string,
	outcome: StreamOutcome
): AsyncGenerator<RunEvent, Message> {
	const final = await deps.messageStore.updateMessage(assistantId, {
		status: outcome.status,
		usage: outcome.usage,
		finishReason: outcome.finishReason,
		error: outcome.errorMessage ? { message: outcome.errorMessage } : null,
	});
	if (outcome.status === "error") {
		await deps.sessionStore.setStatus(sessionId, "error");
		yield { type: "error", message: outcome.errorMessage ?? "stream error" };
	} else {
		yield {
			type: "done",
			usage: outcome.usage,
			finishReason: outcome.finishReason,
		};
	}
	return final ?? assistantFallback;
}

export function createSessionRuntime(deps: SessionRuntimeDeps): SessionRuntime {
	return {
		async *runTurn({ sessionId, text, abortSignal }) {
			const { session, agent } = await loadContext(deps, sessionId);
			await persistUserTurn(deps.messageStore, sessionId, text);
			const assistant = await deps.messageStore.createMessage({
				sessionId,
				role: "assistant",
				status: "streaming",
				providerId: agent.providerId,
				modelId: agent.modelId,
			});
			yield { type: "message-start", messageId: assistant.id };
			const history = await deps.messageStore.listWithParts(sessionId);
			const messages = toModelMessages({
				systemPrompt: agent.systemPrompt,
				summary: session.summary,
				compactedThroughSeq: session.compactedThroughSeq,
				history,
			});
			const model = await deps.modelFactory.create(
				agent.providerId,
				agent.modelId
			);
			const outcome = yield* streamAssistant(
				deps,
				model,
				messages,
				agent.params,
				assistant.id,
				abortSignal
			);
			return yield* finalizeAssistant(
				deps,
				assistant.id,
				assistant,
				sessionId,
				outcome
			);
		},
	};
}
