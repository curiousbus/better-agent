import type { streamText } from "ai";
import type { MessageStore } from "../ports";
import type { ToolDef } from "../tool/types";
import { classifyError } from "./error-classify";
import type { RunEvent } from "./events";
import type { PartBuf } from "./part-buffer";
import type { StreamOutcome } from "./retry-helpers";
import { mapFinishReason, mapUsage } from "./stream-mapping";

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
	ctx: DrainCtx
): AsyncGenerator<RunEvent, void> {
	const callId = chunk.toolCallId as string;
	const toolName = chunk.toolName as string;
	const args = chunk.input;
	await ctx.messageStore.appendPart({
		messageId: ctx.assistantId,
		type: "tool-call",
		content: { callId, toolName, args },
		status: "complete",
	});
	yield { type: "tool-call", callId, toolName, args };
}

async function* drainToolResult(
	chunk: Record<string, unknown>,
	ctx: DrainCtx
): AsyncGenerator<RunEvent, void> {
	const callId = chunk.toolCallId as string;
	const result = chunk.output;
	await ctx.messageStore.appendPart({
		messageId: ctx.assistantId,
		type: "tool-result",
		content: { callId, result, isError: false },
		status: "complete",
	});
	yield { type: "tool-result", callId, result, isError: false };
}

export async function* drainStream(
	result: ReturnType<typeof streamText>,
	textBuf: PartBuf,
	reasoningBuf: PartBuf,
	state: StreamOutcome,
	ctx: DrainCtx
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
		} else if (chunk.type === "tool-call") {
			yield* drainToolCall(chunk as Record<string, unknown>, ctx);
		} else if (chunk.type === "tool-result") {
			yield* drainToolResult(chunk as Record<string, unknown>, ctx);
		}
	}
}
