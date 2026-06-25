import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import type { ModelMessage } from "ai";
import { hasToolCall, stepCountIs, streamText } from "ai";
import type { AgentParams } from "../agent/types";
import type {
	AgentStore,
	MessageStore,
	ModelCacheStore,
	ProviderCatalogStore,
	SessionStore,
} from "../ports";
import { applyCachePolicy, resolveCachePolicy } from "../provider/cache-policy";
import type { ModelFactory } from "../provider/model-factory";
import { buildTools } from "../tool/registry";
import type { ToolDef } from "../tool/types";
import type { Summarizer } from "./compaction";
import { classifyError } from "./error-classify";
import type { RunEvent } from "./events";
import { buildSettings } from "./model-settings";
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
import { finalizeAssistant } from "./runtime-finalize";
import { SessionBusyError, type SessionLock } from "./session-lock";
import {
	buildStructuredOutputToolDef,
	STRUCTURED_OUTPUT_TOOL_NAME,
} from "./structured-output";
import type { Titler } from "./titler";
import { maybeTitle } from "./titler";
import {
	buildTurnMessages,
	loadContext,
	persistUserTurn,
} from "./turn-messages";
import type { Message, PartStatus } from "./types";

const DEFAULT_MAX_STEPS = 50;

export interface SessionRuntimeDeps {
	agentStore: AgentStore;
	clock?: () => Date;
	messageStore: MessageStore;
	modelCacheStore: ModelCacheStore;
	modelFactory: ModelFactory;
	providerCatalogStore: ProviderCatalogStore;
	sessionLock: SessionLock;
	sessionStore: SessionStore;
	sleep?: (ms: number) => Promise<void>;
	summarizer: Summarizer;
	titler?: Titler;
}

export interface RunTurnInput {
	abortSignal?: AbortSignal;
	outputSchema?: Record<string, unknown>;
	sessionId: string;
	text: string;
	tools?: ToolDef[];
}

export interface SessionRuntime {
	runTurn(input: RunTurnInput): AsyncGenerator<RunEvent, Message>;
}

type AiModel = Awaited<ReturnType<ModelFactory["create"]>>;

interface AttemptArgs {
	abortSignal?: AbortSignal;
	cacheToolDefs?: boolean;
	ctx: DrainCtx;
	messages: ModelMessage[];
	model: AiModel;
	params: AgentParams | null;
	providerOptions: SharedV3ProviderOptions;
	structuredOutput?: boolean;
}

async function* runAttempt(
	args: AttemptArgs,
	bufs: {
		text: ReturnType<typeof createPartBuffer>;
		reasoning: ReturnType<typeof createPartBuffer>;
	},
	state: StreamOutcome
): AsyncGenerator<RunEvent, void> {
	const { model, messages, providerOptions, params, ctx, abortSignal } = args;
	try {
		const tools = buildTools(
			ctx.toolDefs,
			{
				sessionId: ctx.sessionId,
				messageId: ctx.assistantId,
				agentId: ctx.agentId,
				abortSignal: abortSignal ?? new AbortController().signal,
			},
			{ cacheLastToolDef: args.cacheToolDefs === true }
		);
		const result = streamText({
			model,
			messages,
			providerOptions,
			stopWhen: args.structuredOutput
				? [
						stepCountIs(DEFAULT_MAX_STEPS),
						hasToolCall(STRUCTURED_OUTPUT_TOOL_NAME),
					]
				: stepCountIs(DEFAULT_MAX_STEPS),
			tools,
			...(args.structuredOutput ? { toolChoice: "required" as const } : {}),
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
	args: AttemptArgs
): AsyncGenerator<RunEvent, StreamOutcome> {
	const { ctx, abortSignal } = args;
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
		structured: null,
	};
	for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
		resetOutcome(state);
		yield* runAttempt(args, bufs, state);
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

interface AssistantCtx {
	assistant: Message;
	ctx: DrainCtx;
}

async function buildAssistantCtx(
	deps: SessionRuntimeDeps,
	agent: { id: string; providerId: string; modelId: string },
	sessionId: string,
	toolDefs: ToolDef[]
): Promise<AssistantCtx> {
	const assistant = await deps.messageStore.createMessage({
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
			messageStore: deps.messageStore,
			sessionId,
			toolDefs,
		},
	};
}

async function* settleTitleEvent(
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

async function* executeTurn(
	deps: SessionRuntimeDeps,
	input: RunTurnInput
): AsyncGenerator<RunEvent, Message> {
	const { sessionId, text, abortSignal, tools } = input;
	const { session, agent } = await loadContext(deps, sessionId);
	await persistUserTurn(deps.messageStore, sessionId, text);
	const titlePromise = maybeTitle(deps, session, agent, text);
	const rawMessages = await buildTurnMessages(deps, agent, session, sessionId);
	const provider = await deps.providerCatalogStore.get(agent.providerId);
	const policy = resolveCachePolicy(provider?.npm ?? null);
	const cached = applyCachePolicy({ messages: rawMessages, sessionId }, policy);
	const toolDefs = [...(tools ?? [])];
	if (input.outputSchema) {
		// Injected last so the model can call remote tools first, then submit.
		// Known nuances (acceptable this iteration): it becomes the Anthropic
		// cache breakpoint (last tool def), and on a later non-structured turn
		// its persisted call replays in history with the tool absent from the
		// active set — benign since its result is an empty no-op.
		toolDefs.push(buildStructuredOutputToolDef(input.outputSchema));
	}
	const { assistant, ctx } = await buildAssistantCtx(
		deps,
		agent,
		sessionId,
		toolDefs
	);
	yield { type: "message-start", messageId: assistant.id };
	const model = await deps.modelFactory.create(agent.providerId, agent.modelId);
	const outcome = yield* streamAssistant(deps, {
		model,
		messages: cached.messages,
		providerOptions: cached.providerOptions,
		params: agent.params,
		ctx,
		abortSignal,
		cacheToolDefs: cached.cacheToolDefs,
		structuredOutput: input.outputSchema != null,
	});
	const message = yield* finalizeAssistant(deps, {
		agent,
		assistantId: assistant.id,
		fallback: assistant,
		sessionId,
		outcome,
	});
	// Settles on done AND error: title derives from the persisted user message.
	yield* settleTitleEvent(deps.sessionStore, sessionId, titlePromise);
	return message;
}

export function createSessionRuntime(deps: SessionRuntimeDeps): SessionRuntime {
	return {
		async *runTurn(input) {
			if (!(await deps.sessionLock.acquire(input.sessionId))) {
				throw new SessionBusyError(input.sessionId);
			}
			try {
				return yield* executeTurn(deps, input);
			} finally {
				await deps.sessionLock.release(input.sessionId);
			}
		},
	};
}
