import type { AdminUserRow } from "@better-agent/agent/auth/types";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { adminProcedure } from "../index";
import { summarizeUsage, usageWindowInput } from "./usage";

const userIdInput = z.object({ userId: z.uuid() });

async function requireCustomer(
	context: Context,
	userId: string
): Promise<AdminUserRow> {
	const customers = await context.services.stores.user.listByKind("customer");
	const row = customers.find((customer) => customer.id === userId);
	if (!row) {
		throw new ORPCError("NOT_FOUND", { message: "Customer not found" });
	}
	return row;
}

// Admin back-office: customer list/detail, usage & activity views, block/unblock.
export const adminCustomersRouter = {
	listCustomers: adminProcedure.handler(({ context }) =>
		context.services.stores.user.listByKind("customer")
	),

	getCustomer: adminProcedure
		.input(userIdInput)
		.handler(async ({ input, context }) => {
			const customer = await requireCustomer(context, input.userId);
			const agents = await context.services.stores.agent.listByUser(
				input.userId
			);
			return { ...customer, agentCount: agents.length };
		}),

	customerUsage: adminProcedure
		.input(userIdInput.extend(usageWindowInput.shape))
		.handler(async ({ input, context }) => {
			await requireCustomer(context, input.userId);
			return summarizeUsage(
				context.services.stores.usage,
				input.userId,
				input.windowDays
			);
		}),

	customerActivity: adminProcedure
		.input(userIdInput)
		.handler(async ({ input, context }) => {
			await requireCustomer(context, input.userId);
			return context.services.stores.activity.listByUser(input.userId);
		}),

	// Block = flag + revoke every refresh token. Access tokens also die at once:
	// every authed request re-reads the user row and rejects blocked accounts.
	blockUser: adminProcedure
		.input(userIdInput)
		.handler(async ({ input, context }) => {
			await requireCustomer(context, input.userId);
			await context.services.stores.user.setBlocked(input.userId, true);
			await context.services.stores.refreshToken.revokeAllForUser(input.userId);
			await context.services.stores.activity.log({
				userId: input.userId,
				type: "account_blocked",
				summary: "Account suspended by admin",
			});
			return { ok: true };
		}),

	unblockUser: adminProcedure
		.input(userIdInput)
		.handler(async ({ input, context }) => {
			await requireCustomer(context, input.userId);
			await context.services.stores.user.setBlocked(input.userId, false);
			await context.services.stores.activity.log({
				userId: input.userId,
				type: "account_unblocked",
				summary: "Account reinstated by admin",
			});
			return { ok: true };
		}),
};
