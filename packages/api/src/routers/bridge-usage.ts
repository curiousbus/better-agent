import { userProcedure } from "../index";
import { usageWindowInput } from "./usage";

const MS_PER_DAY = 86_400_000;

/** Owner-scoped Local Agent usage broken down by agent kind, over the same
 * rolling window (3/7/12 days) the chat usage summary uses. Only kinds with a
 * persisted `turn_usage` event in the window appear — the web zero-fills the
 * rest so every kind's structure is still visible. */
export const usageByAgentKind = userProcedure
	.input(usageWindowInput)
	.handler(async ({ input, context }) => {
		const since = new Date(Date.now() - input.windowDays * MS_PER_DAY);
		const byKind = await context.services.stores.bridgeUsage.usageByAgentKind(
			context.authedUser.id,
			since
		);
		return { windowDays: input.windowDays, byKind };
	});
