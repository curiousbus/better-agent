import type { RunEvent } from "@better-agent/agent/session/events";
import type { ToolDef } from "@better-agent/agent/tool/types";
import { errorMessage } from "./sessions";

export interface ToolCall {
	args: Record<string, unknown>;
	callId: string;
	name: string;
}

const UNKNOWN_TOOL_RESULT = JSON.stringify({ error: "unknown_tool" });

function toolResult(
	call: ToolCall,
	result: unknown,
	isError: boolean
): RunEvent {
	return {
		type: "tool-result",
		callId: call.callId,
		name: call.name,
		result,
		isError,
	};
}

/**
 * Execute one named tool directly (no model). Never rejects: an unknown tool or
 * a thrown error becomes an `isError` tool-result so one bad call can't sink the
 * batch.
 */
export function executeToolCall(
	def: ToolDef | undefined,
	call: ToolCall,
	sessionId: string,
	signal: AbortSignal | undefined
): Promise<RunEvent> {
	if (!def) {
		return Promise.resolve(toolResult(call, UNKNOWN_TOOL_RESULT, true));
	}
	return def
		.execute(call.args, {
			abortSignal: signal ?? new AbortController().signal,
			agentId: "",
			callId: call.callId,
			messageId: "",
			sessionId,
		})
		.then((res) => toolResult(call, res.output, res.isError ?? false))
		.catch((error: unknown) =>
			toolResult(call, JSON.stringify({ error: errorMessage(error) }), true)
		);
}

/**
 * Yield each settled event in COMPLETION order (the fast tool first), so a board
 * can paint each column the instant its read resolves rather than awaiting the
 * slowest. Inputs must not reject (see executeToolCall).
 */
export async function* streamSettled(
	promises: Promise<RunEvent>[]
): AsyncGenerator<RunEvent, void> {
	const pending = new Map<
		number,
		Promise<{ event: RunEvent; index: number }>
	>();
	promises.forEach((promise, index) => {
		pending.set(
			index,
			promise.then((event) => ({ event, index }))
		);
	});
	while (pending.size > 0) {
		const { event, index } = await Promise.race(pending.values());
		pending.delete(index);
		yield event;
	}
}
