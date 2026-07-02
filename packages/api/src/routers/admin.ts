import { SUPER_ADMIN_EMAIL } from "@better-agent/agent/auth/admin";
import { hashPassword } from "@better-agent/agent/crypto/password";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { adminProcedure } from "../index";
import { adminCustomersRouter } from "./admin-customers";

export const adminRouter = {
	...adminCustomersRouter,

	// Back-office (staff) users only. Customers live on the web plane.
	listStaff: adminProcedure.handler(({ context }) =>
		context.services.stores.user.listByKind("staff")
	),

	createStaff: adminProcedure
		.input(z.object({ email: z.email(), password: z.string().min(8) }))
		.handler(async ({ input, context }) => {
			const existing = await context.services.stores.user.findByEmail(
				input.email
			);
			if (existing) {
				throw new ORPCError("CONFLICT", {
					message: "A user with this email already exists",
				});
			}
			return context.services.stores.user.createWithPassword(
				input.email,
				hashPassword(input.password),
				"staff"
			);
		}),

	deleteStaff: adminProcedure
		.input(z.object({ userId: z.uuid() }))
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
