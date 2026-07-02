import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";

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
// INTERNAL_SERVER_ERROR, whose message oRPC masks) so the owner sees the reason.
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

// Asserts the account exists AND belongs to the caller. NOT_FOUND for both
// missing and other-owner accounts, so ownership never leaks.
export async function requireOwnedComposioAccount(
	context: Context,
	userId: string,
	accountId: string
) {
	const account =
		await context.services.stores.composioAccount.getById(accountId);
	if (!account || account.userId !== userId) {
		throw new ORPCError("NOT_FOUND", {
			message: "Composio account not found",
		});
	}
	return account;
}

async function requireOwnedService(
	context: Context,
	userId: string,
	accountId: string
) {
	await requireOwnedComposioAccount(context, userId, accountId);
	const service = await context.services.composio(accountId);
	if (!service) {
		throw new ORPCError("NOT_FOUND", {
			message: "Composio account not found",
		});
	}
	return service;
}

async function createOwnedAccount(
	context: Context,
	userId: string,
	input: { name: string; apiKey: string }
) {
	const account = await context.services.stores.composioAccount.create({
		...input,
		userId,
	});
	// Validate the key against composio (cheap call); roll back a bad key so the
	// owner gets immediate, clear feedback instead of a broken account.
	try {
		const service = await context.services.composio(account.id);
		if (service) {
			await service.listConnections(account.id);
		}
	} catch (error) {
		await context.services.stores.composioAccount.delete(account.id);
		throw toComposioError(error);
	}
	await context.services.stores.activity.log({
		userId,
		type: "composio_account_added",
		summary: `Added Composio account “${account.name}”`,
	});
	return account;
}

// Per-user composio: each user brings their OWN API key; accounts and their
// toolkit connections are visible and usable only by their owner.
export const composioRouter = {
	listAccounts: authorizedUserProcedure.handler(({ context }) =>
		context.services.stores.composioAccount.listByUser(context.authedUser.id)
	),

	createAccount: authorizedUserProcedure
		.input(z.object({ name: z.string().min(1), apiKey: z.string().min(1) }))
		.handler(({ input, context }) =>
			createOwnedAccount(context, context.authedUser.id, input)
		),

	deleteAccount: authorizedUserProcedure
		.input(accountIdInput)
		.handler(async ({ input, context }) => {
			const account = await requireOwnedComposioAccount(
				context,
				context.authedUser.id,
				input.accountId
			);
			await context.services.stores.composioAccount.delete(input.accountId);
			await context.services.stores.activity.log({
				userId: context.authedUser.id,
				type: "composio_account_removed",
				summary: `Removed Composio account “${account.name}”`,
			});
			return { ok: true };
		}),

	toolkits: authorizedUserProcedure
		.input(accountIdInput)
		.handler(async ({ input, context }) => {
			const service = await requireOwnedService(
				context,
				context.authedUser.id,
				input.accountId
			);
			return callComposio(() => service.listToolkits());
		}),

	connections: authorizedUserProcedure
		.input(accountIdInput)
		.handler(async ({ input, context }) => {
			const service = await requireOwnedService(
				context,
				context.authedUser.id,
				input.accountId
			);
			return callComposio(() => service.listConnections(input.accountId));
		}),

	connect: authorizedUserProcedure
		.input(accountIdInput.extend({ toolkit: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const service = await requireOwnedService(
				context,
				context.authedUser.id,
				input.accountId
			);
			return callComposio(() =>
				service.connect(input.accountId, input.toolkit)
			);
		}),

	disconnect: authorizedUserProcedure
		.input(accountIdInput.extend({ connectionId: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const service = await requireOwnedService(
				context,
				context.authedUser.id,
				input.accountId
			);
			await callComposio(() => service.disconnect(input.connectionId));
			return { ok: true };
		}),
};
