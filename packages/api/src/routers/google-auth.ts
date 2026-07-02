import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { publicProcedure } from "../index";
import { enforce } from "./auth";
import { issueTokens } from "./auth-tokens";

const LIMIT_GOOGLE_IP = 30;

export const googleAuthRouter = {
	googleAuthUrl: publicProcedure
		.input(z.object({ state: z.string().min(1) }))
		.handler(({ input, context }) => {
			const google = context.services.googleOAuth;
			if (!google) {
				throw new ORPCError("NOT_FOUND", {
					message: "Google sign-in is not configured",
				});
			}
			return { url: google.authUrl(input.state) };
		}),

	googleSignIn: publicProcedure
		.input(z.object({ code: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const google = context.services.googleOAuth;
			if (!google) {
				throw new ORPCError("NOT_FOUND", {
					message: "Google sign-in is not configured",
				});
			}
			await enforce(
				context.services.rateLimiter,
				`google:ip:${context.clientIp}`,
				LIMIT_GOOGLE_IP
			);
			const profile = await google.exchangeCode(input.code);
			if (!profile.emailVerified) {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Your Google email is not verified",
				});
			}
			const user = await context.services.stores.user.findOrCreate(
				profile.email
			);
			await context.services.stores.user.markEmailVerified(user.id);
			return issueTokens(context, user);
		}),
};
