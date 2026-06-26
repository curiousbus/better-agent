import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { adminProcedure } from "../index";

const accountIdInput = z.object({ accountId: z.uuid() });

async function requireService(context: Context, accountId: string) {
	const service = await context.services.composio(accountId);
	if (!service) {
		throw new ORPCError("NOT_FOUND", {
			message: "Composio account not found",
		});
	}
	return service;
}

export const composioAdminRouter = {
	listAccounts: adminProcedure.handler(({ context }) =>
		context.services.stores.composioAccount.list()
	),

	createAccount: adminProcedure
		.input(
			z.object({
				name: z.string().min(1),
				apiKey: z.string().min(1),
			})
		)
		.handler(({ input, context }) =>
			context.services.stores.composioAccount.create(input)
		),

	deleteAccount: adminProcedure
		.input(accountIdInput)
		.handler(async ({ input, context }) => {
			await context.services.stores.composioAccount.delete(input.accountId);
			return { ok: true };
		}),

	toolkits: adminProcedure
		.input(accountIdInput)
		.handler(async ({ input, context }) => {
			const service = await requireService(context, input.accountId);
			return service.listToolkits();
		}),

	connections: adminProcedure
		.input(accountIdInput)
		.handler(async ({ input, context }) => {
			const service = await requireService(context, input.accountId);
			return service.listConnections(input.accountId);
		}),

	connect: adminProcedure
		.input(accountIdInput.extend({ toolkit: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const service = await requireService(context, input.accountId);
			return service.connect(input.accountId, input.toolkit);
		}),

	disconnect: adminProcedure
		.input(accountIdInput.extend({ connectionId: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const service = await requireService(context, input.accountId);
			await service.disconnect(input.connectionId);
			return { ok: true };
		}),
};
