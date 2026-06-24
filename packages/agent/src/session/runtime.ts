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
import { buildTools } from "../tool/registry";
import type { ToolDef } from "../tool/types";
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
import type { DrainCtx } from "./runtime-drain";
import { drainStream } from "./runtime-drain";
import { SessionBusyError, type SessionLock } from "./session-lock";
import {
	buildTurnMessages,
	loadContext,
	persistUserTurn,
} from "./turn-messages";
import type { Message, PartStatus } from "./types";

const DEFAULT_MAX_STEPS = 50;

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
	tools?: ToolDef[];
}

export interface SessionRuntime {
	runTurn(input: RunTurnInput): AsyncGenerator<RunEvent, Message>;
}

type AiModel = Awaited<ReturnType<ModelFactory["create"]>>;

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

async function* runAttempt(
	model: AiModel,
	messages: ModelMessage[],
	params: AgentParams | null,
	bufs: {
		text: ReturnType<typeof createPartBuffer>;
		reasoning: ReturnType<typeof createPartBuffer>;
	},
	state: StreamOutcome,
	ctx: DrainCtx,
	abortSignal?: AbortSignal
): AsyncGenerator<RunEvent, void> {
	try {
		const tools = buildTools(ctx.toolDefs, {
			sessionId: ctx.sessionId,
			messageId: ctx.assistantId,
			agentId: ctx.agentId,
			abortSignal: abortSignal ?? new AbortController().signal,
		});
		const result = streamText({
			model,
			messages,
			stopWhen: stepCountIs(DEFAULT_MAX_STEPS),
			tools,
			experimental_repairToolCall: () => Promise.resolve(null),
			abortSignal,
			maxRetries: 0,
			...buildSettings(params),
		});
		yield* drainStream(result, bufs, state, ctx);
	} catch (error) {
		if (abortSignal?.aborted) {
			state.status = "aborted";
		} else {
			state.status = "error";
			state.finishReason = "error";
			state.errorMessage =
				error instanceof Error ? error.message : String(error);
			state.errorCategory = classifyError(error);
		}
	}
}

async function* streamAssistant(
	deps: SessionRuntimeDeps,
	model: AiModel,
	messages: ModelMessage[],
	params: AgentParams | null,
	ctx: DrainCtx,
	abortSignal?: AbortSignal
): AsyncGenerator<RunEvent, StreamOutcome> {
	const bufs = {
		text: createPartBuffer(deps.messageStore, ctx.assistantId, "text"),
		reasoning: createPartBuffer(
			deps.messageStore,
			ctx.assistantId,
			"reasoning"
		),
	};
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
		yield* runAttempt(model, messages, params, bufs, state, ctx, abortSignal);
		if (shouldRetryAttempt(state, attempt, abortSignal?.aborted ?? false)) {
			await sleep(backoffMs(attempt));
			continue;
		}
		break;
	}
	const partStatus: PartStatus =
		state.status === "error" ? "error" : "complete";
	await bufs.reasoning.flush(partStatus);
	await bufs.text.flush(partStatus);
	return state;
}

async function* finalizeAssistant(
	deps: Pick<SessionRuntimeDeps, "messageStore" | "sessionStore">,
	assistantId: string,
	fallback: Message,
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
	return final ?? fallback;
}

async function* executeTurn(
	deps: SessionRuntimeDeps,
	input: RunTurnInput
): AsyncGenerator<RunEvent, Message> {
	const { sessionId, text, abortSignal, tools } = input;
	const { session, agent } = await loadContext(deps, sessionId);
	await persistUserTurn(deps.messageStore, sessionId, text);
	const messages = await buildTurnMessages(deps, agent, session, sessionId);
	const assistant = await deps.messageStore.createMessage({
		sessionId,
		role: "assistant",
		status: "streaming",
		providerId: agent.providerId,
		modelId: agent.modelId,
	});
	yield { type: "message-start", messageId: assistant.id };
	const model = await deps.modelFactory.create(agent.providerId, agent.modelId);
	const ctx: DrainCtx = {
		agentId: agent.id,
		assistantId: assistant.id,
		messageStore: deps.messageStore,
		sessionId,
		toolDefs: tools ?? [],
	};
	const outcome = yield* streamAssistant(
		deps,
		model,
		messages,
		agent.params,
		ctx,
		abortSignal
	);
	return yield* finalizeAssistant(
		deps,
		assistant.id,
		assistant,
		sessionId,
		outcome
	);
}

export function createSessionRuntime(deps: SessionRuntimeDeps): SessionRuntime {
	return {
		async *runTurn(input) {
			if (!deps.sessionLock.acquire(input.sessionId)) {
				throw new SessionBusyError(input.sessionId);
			}
			try {
				return yield* executeTurn(deps, input);
			} finally {
				deps.sessionLock.release(input.sessionId);
			}
		},
	};
}
