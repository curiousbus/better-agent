import { expect, it } from "vitest";
import type { MessageUsage } from "../session/types";
import { computeCost } from "./cost";

const baseUsage: MessageUsage = {
	inputTokens: 1_000_000,
	outputTokens: 1_000_000,
	totalTokens: null,
	reasoningTokens: null,
	cacheReadTokens: null,
	cacheWriteTokens: null,
	costCents: null,
};

it("computes input + output cost in cents", () => {
	// $3/M in, $15/M out → 300c + 1500c = 1800c
	expect(
		computeCost(baseUsage, { inputPricePerM: 3, outputPricePerM: 15 })
	).toBe(1800);
});

it("bills cache-read at 0.1x input and cache-write at 1.25x input", () => {
	const usage = {
		...baseUsage,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 1_000_000,
		cacheWriteTokens: 1_000_000,
	};
	// 1M*3*0.1 = 30c (read) + 1M*3*1.25 = 375c (write) = 405c
	expect(computeCost(usage, { inputPricePerM: 3, outputPricePerM: 15 })).toBe(
		405
	);
});

it("bills reasoning tokens at the output rate", () => {
	const usage = {
		...baseUsage,
		inputTokens: 0,
		outputTokens: 0,
		reasoningTokens: 1_000_000,
	};
	expect(computeCost(usage, { inputPricePerM: 3, outputPricePerM: 15 })).toBe(
		1500
	);
});

it("returns null when pricing is missing", () => {
	expect(
		computeCost(baseUsage, { inputPricePerM: null, outputPricePerM: null })
	).toBeNull();
});

it("returns null when only one price is null", () => {
	expect(
		computeCost(baseUsage, { inputPricePerM: null, outputPricePerM: 15 })
	).toBeNull();
	expect(
		computeCost(baseUsage, { inputPricePerM: 3, outputPricePerM: null })
	).toBeNull();
});
