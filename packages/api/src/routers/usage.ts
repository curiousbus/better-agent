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

export const usageRouter = {
	// Per-user token usage over a rolling window (3/7/12 days): daily input/output
	// tokens + cost, plus totals. Aggregated from messages.usage (owner's sessions).
	summary: authorizedUserProcedure
		.input(
			z.object({
				windowDays: z.union([z.literal(3), z.literal(7), z.literal(12)]),
			})
		)
		.handler(async ({ input, context }) => {
			const since = new Date(Date.now() - input.windowDays * MS_PER_DAY);
			const daily = await context.services.stores.usage.dailySummary(
				context.authedUser.id,
				since
			);
			const totals = daily.reduce<Totals>(
				(acc, day) => ({
					costCents: acc.costCents + day.costCents,
					inputTokens: acc.inputTokens + day.inputTokens,
					outputTokens: acc.outputTokens + day.outputTokens,
					turns: acc.turns + day.turns,
				}),
				EMPTY_TOTALS
			);
			return { windowDays: input.windowDays, daily, totals };
		}),
};
