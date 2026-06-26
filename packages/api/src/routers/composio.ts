import { composioKeyName } from "@better-agent/agent/tool/composio-tools";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { userProcedure } from "../index";

export const composioRouter = {
	keyStatus: userProcedure.handler(async ({ context }) => {
		const key = await context.services.stores.settings.get(
			composioKeyName(context.authedUser.id)
		);
		return { configured: key !== null };
	}),
	setKey: userProcedure
		.input(z.object({ apiKey: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			await context.services.stores.settings.set(
				composioKeyName(context.authedUser.id),
				input.apiKey
			);
			return { ok: true };
		}),
	clearKey: userProcedure.handler(async ({ context }) => {
		await context.services.stores.settings.delete(
			composioKeyName(context.authedUser.id)
		);
		return { ok: true };
	}),
	connectableToolkits: userProcedure.handler(async ({ context }) => {
		const svc = await context.services.composio(context.authedUser.id);
		if (!svc) {
			return { configured: false, toolkits: [] };
		}
		try {
			const all = await svc.listToolkits();
			return { configured: true, toolkits: all.filter((t) => t.needsAuth) };
		} catch {
			return { configured: true, toolkits: [] };
		}
	}),
	connections: userProcedure.handler(async ({ context }) => {
		const svc = await context.services.composio(context.authedUser.id);
		if (!svc) {
			return [];
		}
		try {
			return await svc.listConnections(context.authedUser.id);
		} catch {
			return [];
		}
	}),
	connect: userProcedure
		.input(z.object({ toolkit: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const svc = await context.services.composio(context.authedUser.id);
			if (!svc) {
				throw new ORPCError("NOT_FOUND", {
					message: "Composio is not configured",
				});
			}
			try {
				return await svc.connect(context.authedUser.id, input.toolkit);
			} catch {
				throw new ORPCError("BAD_REQUEST", {
					message: "Could not start the connection",
				});
			}
		}),
	disconnect: userProcedure
		.input(z.object({ id: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const svc = await context.services.composio(context.authedUser.id);
			if (!svc) {
				throw new ORPCError("NOT_FOUND", {
					message: "Composio is not configured",
				});
			}
			const mine = await svc.listConnections(context.authedUser.id);
			if (!mine.some((c) => c.id === input.id)) {
				throw new ORPCError("NOT_FOUND", { message: "Connection not found" });
			}
			await svc.disconnect(input.id);
			return { ok: true };
		}),
};
