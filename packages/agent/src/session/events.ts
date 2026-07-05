import type { FinishReason, MessageUsage } from "./types";

/** runTurn 向客户端 yield 的事件。 */
export type RunEvent =
	| { type: "message-start"; messageId: string }
	| { type: "text-delta"; delta: string }
	| { type: "reasoning-delta"; delta: string }
	| { type: "step-finish" }
	| {
			type: "done";
			usage: MessageUsage | null;
			finishReason: FinishReason;
	  }
	| { type: "error"; message: string }
	| { type: "tool-call"; callId: string; toolName: string; args: unknown }
	| {
			type: "tool-result";
			callId: string;
			name?: string;
			result: unknown;
			isError: boolean;
	  }
	| { type: "title"; title: string };
