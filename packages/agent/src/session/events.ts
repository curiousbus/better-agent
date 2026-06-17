import type { FinishReason, MessageUsage } from "./types";

/** runTurn 向客户端 yield 的事件。tool-call/tool-result 事件 📐 留待工具阶段。 */
export type RunEvent =
	| { type: "message-start"; messageId: string }
	| { type: "text-delta"; delta: string }
	| { type: "reasoning-delta"; delta: string }
	| { type: "step-finish" }
	| { type: "done"; usage: MessageUsage | null; finishReason: FinishReason }
	| { type: "error"; message: string };
