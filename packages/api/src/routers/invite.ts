import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { isWebAuthorized, userProcedure } from "../index";

// Ungated (a not-yet-authorized user must be able to check status + redeem).
export const inviteRouter = {
	status: userProcedure.handler(async ({ context }) => ({
		required: context.services.authz.enabled,
		authorized: await isWebAuthorized(context, context.authedUser.id),
	})),

	redeem: userProcedure
		.input(z.object({ code: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const result = await context.services.authz.redeem(
				context.authedUser.id,
				input.code
			);
			await context.services.stores.webAuthzCache.set(
				context.authedUser.id,
				result.authorized
			);
			if (!result.authorized) {
				throw new ORPCError("BAD_REQUEST", {
					message: result.reason ?? "Invalid invite code",
				});
			}
			return { ok: true };
		}),
};
