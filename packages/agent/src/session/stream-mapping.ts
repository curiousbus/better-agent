import type { FinishReason as AiFinishReason, LanguageModelUsage } from "ai";
import type { FinishReason, MessageUsage } from "./types";

/** 读取 LanguageModelUsage 中所有需要的字段；完整类型可结构赋值到此。详细字段可选。 */
type UsageInput = Pick<
	LanguageModelUsage,
	"inputTokens" | "outputTokens" | "totalTokens"
> &
	Partial<Pick<LanguageModelUsage, "inputTokenDetails" | "outputTokenDetails">>;

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
		reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? null,
		cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? null,
		cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? null,
		costCents: null,
	};
}
