import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { adminProcedure, userProcedure } from "../index";

export const composioRouter = {
	// The composio toolkit catalog, admin-only. Graceful: not configured when no
	// COMPOSIO_API_KEY; empty when the upstream call fails (never breaks the page).
	listToolkits: adminProcedure.handler(async ({ context }) => {
		const svc = await context.services.composio();
		if (!svc) {
			return { configured: false, toolkits: [] };
		}
		try {
			return { configured: true, toolkits: await svc.listToolkits() };
		} catch {
			return { configured: true, toolkits: [] };
		}
	}),

	connectableToolkits: userProcedure.handler(async ({ context }) => {
		const svc = await context.services.composio();
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
		const svc = await context.services.composio();
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
			const svc = await context.services.composio();
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
			const svc = await context.services.composio();
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
			return { ok: true as const };
		}),
};
