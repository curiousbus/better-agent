import type { streamText } from "ai";
import type { MessageStore } from "../ports";
import type { ToolDef } from "../tool/types";
import { classifyError } from "./error-classify";
import type { RunEvent } from "./events";
import type { PartBuf } from "./part-buffer";
import type { StreamOutcome } from "./retry-helpers";
import { mapFinishReason, mapUsage } from "./stream-mapping";
import { STRUCTURED_OUTPUT_TOOL_NAME } from "./structured-output";

export interface DrainCtx {
	agentId: string;
	assistantId: string;
	messageStore: MessageStore;
	sessionId: string;
	toolDefs: ToolDef[];
}

function errorToMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function* drainToolCall(
	chunk: Record<string, unknown>,
	ctx: DrainCtx,
	state: StreamOutcome
): AsyncGenerator<RunEvent, void> {
	const callId = chunk.toolCallId as string;
	const toolName = chunk.toolName as string;
	const args = chunk.input;
	if (toolName === STRUCTURED_OUTPUT_TOOL_NAME) {
		state.structured = args;
	}
	await ctx.messageStore.appendPart({
		messageId: ctx.assistantId,
		type: "tool-call",
		content: { callId, toolName, args },
		status: "complete",
	});
	state.emittedOutput = true;
	yield { type: "tool-call", callId, toolName, args };
}

async function* drainToolResult(
	chunk: Record<string, unknown>,
	ctx: DrainCtx,
	isError: boolean
): AsyncGenerator<RunEvent, void> {
	const callId = chunk.toolCallId as string;
	const result = isError ? errorToMessage(chunk.error) : chunk.output;
	await ctx.messageStore.appendPart({
		messageId: ctx.assistantId,
		type: "tool-result",
		content: { callId, result, isError },
		status: "complete",
	});
	yield { type: "tool-result", callId, result, isError };
}

/** Handles non-yielding state-update chunks. Returns true if handled. */
function applyStateChunk(
	chunk: { type: string; [k: string]: unknown },
	state: StreamOutcome
): boolean {
	if (chunk.type === "finish") {
		state.usage = mapUsage(chunk.totalUsage as Parameters<typeof mapUsage>[0]);
		state.finishReason = mapFinishReason(
			chunk.finishReason as Parameters<typeof mapFinishReason>[0]
		);
		return true;
	}
	if (chunk.type === "error") {
		state.status = "error";
		state.finishReason = "error";
		state.errorMessage = errorToMessage(chunk.error);
		state.errorCategory = classifyError(chunk.error);
		return true;
	}
	if (chunk.type === "abort") {
		state.status = "aborted";
		return true;
	}
	return false;
}

interface DrainBufs {
	reasoning: PartBuf;
	text: PartBuf;
}

export async function* drainStream(
	result: ReturnType<typeof streamText>,
	bufs: DrainBufs,
	state: StreamOutcome,
	ctx: DrainCtx
): AsyncGenerator<RunEvent, void> {
	for await (const chunk of result.fullStream) {
		if (chunk.type === "text-delta") {
			state.emittedOutput = true;
			await bufs.text.append(chunk.text);
			yield { type: "text-delta", delta: chunk.text };
		} else if (chunk.type === "reasoning-delta") {
			state.emittedOutput = true;
			await bufs.reasoning.append(chunk.text);
			yield { type: "reasoning-delta", delta: chunk.text };
		} else if (chunk.type === "finish-step") {
			await bufs.text.finishStep();
			await bufs.reasoning.finishStep();
			yield { type: "step-finish" };
		} else if (chunk.type === "tool-call") {
			yield* drainToolCall(chunk as Record<string, unknown>, ctx, state);
		} else if (chunk.type === "tool-result") {
			yield* drainToolResult(chunk as Record<string, unknown>, ctx, false);
		} else if (chunk.type === "tool-error") {
			yield* drainToolResult(chunk as Record<string, unknown>, ctx, true);
		} else {
			applyStateChunk(chunk as { type: string; [k: string]: unknown }, state);
		}
	}
}
