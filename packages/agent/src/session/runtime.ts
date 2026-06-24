import type { ModelMessage } from "ai";
import { stepCountIs, streamText } from "ai";
import type { AgentParams } from "../agent/types";
import type {
	AgentStore,
	MessageStore,
	ModelCacheStore,
	SessionStore,
} from "../ports";
import type { ModelFactory } from "../provider/model-factory";
import type { Summarizer } from "./compaction";
import { classifyError } from "./error-classify";
import type { RunEvent } from "./events";
import { createPartBuffer } from "./part-buffer";
import type { StreamOutcome } from "./retry-helpers";
import {
	backoffMs,
	defaultSleep,
	MAX_LLM_ATTEMPTS,
	resetOutcome,
	shouldRetryAttempt,
} from "./retry-helpers";
import { SessionBusyError, type SessionLock } from "./session-lock";
import { mapFinishReason, mapUsage } from "./stream-mapping";
import {
	buildTurnMessages,
	loadContext,
	persistUserTurn,
} from "./turn-messages";
import type { Message, PartStatus } from "./types";

const MAX_STEPS = 1; // P1 无工具；工具阶段（P2）再调高

export interface SessionRuntimeDeps {
	agentStore: AgentStore;
	messageStore: MessageStore;
	modelCacheStore: ModelCacheStore;
	modelFactory: ModelFactory;
	sessionLock: SessionLock;
	sessionStore: SessionStore;
	sleep?: (ms: number) => Promise<void>;
	summarizer: Summarizer;
}

export interface RunTurnInput {
	abortSignal?: AbortSignal;
	sessionId: string;
	text: string;
}

export interface SessionRuntime {
	runTurn(input: RunTurnInput): AsyncGenerator<RunEvent, Message>;
}

type AiModel = Awaited<ReturnType<ModelFactory["create"]>>;
type PartBuf = ReturnType<typeof createPartBuffer>;

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

async function* drainStream(
	result: ReturnType<typeof streamText>,
	textBuf: PartBuf,
	reasoningBuf: PartBuf,
	state: StreamOutcome
): AsyncGenerator<RunEvent, void> {
	for await (const chunk of result.fullStream) {
		if (chunk.type === "text-delta") {
			state.emittedOutput = true;
			await textBuf.append(chunk.text);
			yield { type: "text-delta", delta: chunk.text };
		} else if (chunk.type === "reasoning-delta") {
			state.emittedOutput = true;
			await reasoningBuf.append(chunk.text);
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
			state.errorCategory = classifyError(chunk.error);
		} else if (chunk.type === "abort") {
			state.status = "aborted";
		}
	}
}

async function* runAttempt(
	model: AiModel,
	messages: ModelMessage[],
	params: AgentParams | null,
	textBuf: PartBuf,
	reasoningBuf: PartBuf,
	state: StreamOutcome,
	abortSignal?: AbortSignal
): AsyncGenerator<RunEvent, void> {
	try {
		const result = streamText({
			model,
			messages,
			stopWhen: stepCountIs(MAX_STEPS),
			tools: {},
			abortSignal,
			maxRetries: 0,
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
			state.errorCategory = classifyError(error);
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
	// Buffers are created once and reused across retry attempts. Safe because a
	// retry only fires when no output was emitted (shouldRetryAttempt requires
	// !emittedOutput), so append() was never called and the buffers are empty.
	// If retry conditions change (e.g. multi-step tool turns), revisit this.
	const textBuf = createPartBuffer(deps.messageStore, assistantId, "text");
	const reasoningBuf = createPartBuffer(
		deps.messageStore,
		assistantId,
		"reasoning"
	);
	const sleep = deps.sleep ?? defaultSleep;
	const state: StreamOutcome = {
		usage: null,
		finishReason: "stop",
		status: "complete",
		errorMessage: null,
		errorCategory: null,
		emittedOutput: false,
	};
	for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
		resetOutcome(state);
		yield* runAttempt(
			model,
			messages,
			params,
			textBuf,
			reasoningBuf,
			state,
			abortSignal
		);
		if (shouldRetryAttempt(state, attempt, abortSignal?.aborted ?? false)) {
			await sleep(backoffMs(attempt));
			continue;
		}
		break;
	}
	const partStatus: PartStatus =
		state.status === "error" ? "error" : "complete";
	await reasoningBuf.flush(partStatus);
	await textBuf.flush(partStatus);
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
			usage: outcome.usage,
			finishReason: outcome.finishReason,
		};
	}
	return final ?? assistantFallback;
}

export function createSessionRuntime(deps: SessionRuntimeDeps): SessionRuntime {
	return {
		async *runTurn({ sessionId, text, abortSignal }) {
			if (!deps.sessionLock.acquire(sessionId)) {
				throw new SessionBusyError(sessionId);
			}
			try {
				const { session, agent } = await loadContext(deps, sessionId);
				await persistUserTurn(deps.messageStore, sessionId, text);
				const messages = await buildTurnMessages(
					deps,
					agent,
					session,
					sessionId
				);
				const assistant = await deps.messageStore.createMessage({
					sessionId,
					role: "assistant",
					status: "streaming",
					providerId: agent.providerId,
					modelId: agent.modelId,
				});
				yield { type: "message-start", messageId: assistant.id };
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
			} finally {
				deps.sessionLock.release(sessionId);
			}
		},
	};
}
