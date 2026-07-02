import type { UsageStore } from "@better-agent/db/repositories/usage-store";
import { z } from "zod";
import { authorizedUserProcedure } from "../index";

const MS_PER_DAY = 86_400_000;

interface Totals {
	costCents: number;
	inputTokens: number;
	outputTokens: number;
	turns: number;
}

const EMPTY_TOTALS: Totals = {
	costCents: 0,
	inputTokens: 0,
	outputTokens: 0,
	turns: 0,
};

export const usageWindowInput = z.object({
	windowDays: z.union([z.literal(3), z.literal(7), z.literal(12)]),
});

/** Daily rows + summed totals for one user over a rolling window. */
export async function summarizeUsage(
	store: UsageStore,
	userId: string,
	windowDays: number
) {
	const since = new Date(Date.now() - windowDays * MS_PER_DAY);
	const daily = await store.dailySummary(userId, since);
	const totals = daily.reduce<Totals>(
		(acc, day) => ({
			costCents: acc.costCents + day.costCents,
			inputTokens: acc.inputTokens + day.inputTokens,
			outputTokens: acc.outputTokens + day.outputTokens,
			turns: acc.turns + day.turns,
		}),
		EMPTY_TOTALS
	);
	return { windowDays, daily, totals };
}

export const usageRouter = {
	// Per-user token usage over a rolling window (3/7/12 days): daily input/output
	// tokens + cost, plus totals. Aggregated from messages.usage (owner's sessions).
	summary: authorizedUserProcedure
		.input(usageWindowInput)
		.handler(({ input, context }) =>
			summarizeUsage(
				context.services.stores.usage,
				context.authedUser.id,
				input.windowDays
			)
		),
};
