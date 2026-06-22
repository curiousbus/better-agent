import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

export const agentProcedure = o.use(({ context, next }) => {
	const agent = context.authedAgent;
	if (!agent) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Missing or invalid agent token",
		});
	}
	return next({ context: { authedAgent: agent } });
});
