import { SUPER_ADMIN_EMAIL } from "@better-agent/agent/auth/admin";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { adminProcedure } from "../index";

export const adminRouter = {
	listUsers: adminProcedure.handler(({ context }) =>
		context.services.stores.user.listAll()
	),

	setUserAdmin: adminProcedure
		.input(z.object({ userId: z.string().uuid(), isAdmin: z.boolean() }))
		.handler(async ({ input, context }) => {
			const target = await context.services.stores.user.findById(input.userId);
			if (!target) {
				throw new ORPCError("NOT_FOUND", { message: "User not found" });
			}
			if (target.email === SUPER_ADMIN_EMAIL && !input.isAdmin) {
				throw new ORPCError("BAD_REQUEST", {
					message: "The super admin cannot be demoted",
				});
			}
			await context.services.stores.user.setAdmin(input.userId, input.isAdmin);
			return { ok: true };
		}),

	deleteUser: adminProcedure
		.input(z.object({ userId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			if (input.userId === context.authedUser.id) {
				throw new ORPCError("BAD_REQUEST", {
					message: "You cannot delete your own account",
				});
			}
			const target = await context.services.stores.user.findById(input.userId);
			if (!target) {
				throw new ORPCError("NOT_FOUND", { message: "User not found" });
			}
			if (target.email === SUPER_ADMIN_EMAIL) {
				throw new ORPCError("BAD_REQUEST", {
					message: "The super admin cannot be deleted",
				});
			}
			await context.services.stores.refreshToken.revokeAllForUser(input.userId);
			await context.services.stores.user.deleteById(input.userId);
			return { ok: true };
		}),
};
