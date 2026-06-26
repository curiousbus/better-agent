import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { adminProcedure } from "../index";

const accountIdInput = z.object({ accountId: z.uuid() });
const HTTP_UNAUTHORIZED = 401;

// composio wraps the upstream HTTP error in a cause chain; dig out its status.
function statusOf(error: unknown): number | undefined {
	const e = error as {
		status?: number;
		statusCode?: number;
		cause?: unknown;
	} | null;
	if (typeof e?.status === "number") {
		return e.status;
	}
	if (typeof e?.statusCode === "number") {
		return e.statusCode;
	}
	return e?.cause ? statusOf(e.cause) : undefined;
}

// Map a composio failure to a client-readable error. Use BAD_REQUEST (not
// INTERNAL_SERVER_ERROR, whose message oRPC masks) so the admin sees the reason.
function toComposioError(error: unknown): ORPCError<string, undefined> {
	const message =
		statusOf(error) === HTTP_UNAUTHORIZED
			? "Composio rejected the API key — it's invalid or expired. Update the key on this account."
			: "Composio request failed. Check the account's API key, then try again.";
	return new ORPCError("BAD_REQUEST", { message });
}

async function callComposio<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		throw toComposioError(error);
	}
}

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
		.handler(async ({ input, context }) => {
			const account =
				await context.services.stores.composioAccount.create(input);
			// Validate the key against composio (cheap call); roll back a bad key so
			// the admin gets immediate, clear feedback instead of a broken account.
			try {
				const service = await context.services.composio(account.id);
				if (service) {
					await service.listConnections(account.id);
				}
			} catch (error) {
				await context.services.stores.composioAccount.delete(account.id);
				throw toComposioError(error);
			}
			return account;
		}),

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
			return callComposio(() => service.listToolkits());
		}),

	connections: adminProcedure
		.input(accountIdInput)
		.handler(async ({ input, context }) => {
			const service = await requireService(context, input.accountId);
			return callComposio(() => service.listConnections(input.accountId));
		}),

	connect: adminProcedure
		.input(accountIdInput.extend({ toolkit: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const service = await requireService(context, input.accountId);
			return callComposio(() =>
				service.connect(input.accountId, input.toolkit)
			);
		}),

	disconnect: adminProcedure
		.input(accountIdInput.extend({ connectionId: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const service = await requireService(context, input.accountId);
			await callComposio(() => service.disconnect(input.connectionId));
			return { ok: true };
		}),
};
