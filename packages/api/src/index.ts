import { isAdminEmail } from "@better-agent/agent/auth/admin";
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

export const userProcedure = o.use(({ context, next }) => {
	const user = context.authedUser;
	if (!user) {
		throw new ORPCError("UNAUTHORIZED", { message: "Sign in required" });
	}
	return next({ context: { authedUser: user } });
});

export const adminProcedure = o.use(async ({ context, next }) => {
	const user = context.authedUser;
	if (!user) {
		throw new ORPCError("UNAUTHORIZED", { message: "Sign in required" });
	}
	const allowed =
		isAdminEmail(user.email, context.services.authConfig.adminEmails) ||
		(await context.services.stores.user.isAdmin(user.id));
	if (!allowed) {
		throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
	}
	return next({ context: { authedUser: user } });
});
