import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { publicProcedure, userProcedure } from "../index";

const MS = 1000;

async function issueTokens(
	context: Context,
	user: { id: string; email: string }
) {
	const { authConfig, jwtService, stores } = context.services;
	const accessToken = await jwtService.sign(
		{ sub: user.id, email: user.email },
		authConfig.accessTtl
	);
	const refreshToken = generateToken("rt_");
	await stores.refreshToken.create({
		userId: user.id,
		tokenHash: hashToken(refreshToken),
		expiresAt: new Date(Date.now() + authConfig.refreshTtl * MS),
	});
	return { accessToken, refreshToken, user };
}

export const authRouter = {
	requestLink: publicProcedure
		.input(z.object({ email: z.email() }))
		.handler(async ({ input, context }) => {
			const { authConfig, emailSender, stores } = context.services;
			const token = generateToken("ml_");
			await stores.magicLink.create({
				tokenHash: hashToken(token),
				email: input.email,
				expiresAt: new Date(Date.now() + authConfig.magicLinkTtl * MS),
			});
			const url = `${authConfig.webUrl}/auth/verify?token=${token}`;
			await emailSender.sendMagicLink({ email: input.email, url });
			return { ok: true };
		}),

	verify: publicProcedure
		.input(z.object({ token: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const consumed = await context.services.stores.magicLink.consume(
				hashToken(input.token)
			);
			if (!consumed) {
				throw new ORPCError("BAD_REQUEST", {
					message: "This link is invalid or has expired",
				});
			}
			const user = await context.services.stores.user.findOrCreate(
				consumed.email
			);
			return issueTokens(context, user);
		}),

	refresh: publicProcedure
		.input(z.object({ refreshToken: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const { stores } = context.services;
			const record = await stores.refreshToken.find(
				hashToken(input.refreshToken)
			);
			if (!record) {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Invalid refresh token",
				});
			}
			if (record.revokedAt) {
				await stores.refreshToken.revokeAllForUser(record.userId);
				throw new ORPCError("UNAUTHORIZED", {
					message: "Refresh token reused",
				});
			}
			if (record.expiresAt < new Date()) {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Refresh token expired",
				});
			}
			const user = await stores.user.findById(record.userId);
			if (!user) {
				throw new ORPCError("UNAUTHORIZED", { message: "Unknown user" });
			}
			await stores.refreshToken.revoke(record.id);
			return issueTokens(context, user);
		}),

	me: userProcedure.handler(({ context }) => context.authedUser),

	logout: publicProcedure
		.input(z.object({ refreshToken: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const record = await context.services.stores.refreshToken.find(
				hashToken(input.refreshToken)
			);
			if (record) {
				await context.services.stores.refreshToken.revoke(record.id);
			}
			return { ok: true };
		}),
};
