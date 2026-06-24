import type { MessageUsage } from "../session/types";

export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;
const CENTS_PER_DOLLAR = 100;
const TOKENS_PER_MILLION = 1_000_000;

interface Pricing {
	inputPricePerM: number | null;
	outputPricePerM: number | null;
}

export function computeCost(
	usage: MessageUsage,
	pricing: Pricing
): number | null {
	if (pricing.inputPricePerM === null || pricing.outputPricePerM === null) {
		return null;
	}
	const inPrice = pricing.inputPricePerM;
	const outPrice = pricing.outputPricePerM;
	const dollars =
		((usage.inputTokens ?? 0) * inPrice +
			(usage.outputTokens ?? 0) * outPrice +
			(usage.cacheReadTokens ?? 0) * inPrice * CACHE_READ_MULTIPLIER +
			(usage.cacheWriteTokens ?? 0) * inPrice * CACHE_WRITE_MULTIPLIER +
			(usage.reasoningTokens ?? 0) * outPrice) /
		TOKENS_PER_MILLION;
	return dollars * CENTS_PER_DOLLAR;
}
