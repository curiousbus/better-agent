import type { FinishReason as AiFinishReason, LanguageModelUsage } from "ai";
import type { FinishReason, MessageUsage } from "./types";

/** 只读 totalUsage 的三字段；完整 LanguageModelUsage 可结构赋值到此。 */
type UsageInput = Pick<
	LanguageModelUsage,
	"inputTokens" | "outputTokens" | "totalTokens"
>;

export function mapFinishReason(reason: AiFinishReason): FinishReason {
	switch (reason) {
		case "stop":
		case "length":
		case "tool-calls":
		case "error":
			return reason;
		case "content-filter":
			return "error";
		default:
			return "stop";
	}
}

export function mapUsage(usage: UsageInput): MessageUsage {
	return {
		inputTokens: usage.inputTokens ?? null,
		outputTokens: usage.outputTokens ?? null,
		totalTokens: usage.totalTokens ?? null,
	};
}
