import { parseUserAgent } from "@better-agent/agent/auth/user-agent";
import { hashToken } from "@better-agent/agent/crypto/auth-tokens";
import { hashPassword } from "@better-agent/agent/crypto/password";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { userProcedure } from "../index";

export const accountRouter = {
	listLogins: userProcedure
		.input(z.object({ currentRefreshToken: z.string().optional() }))
		.handler(async ({ input, context }) => {
			const tokens =
				await context.services.stores.refreshToken.listActiveByUser(
					context.authedUser.id
				);
			const currentHash = input.currentRefreshToken
				? hashToken(input.currentRefreshToken)
				: null;
			return tokens.map((t) => ({
				id: t.id,
				label: parseUserAgent(t.userAgent),
				createdAt: t.createdAt,
				current: currentHash !== null && t.tokenHash === currentHash,
			}));
		}),

	revokeLogin: userProcedure
		.input(z.object({ id: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			await context.services.stores.refreshToken.revokeForUser(
				input.id,
				context.authedUser.id
			);
			return { ok: true as const };
		}),

	revokeOthers: userProcedure
		.input(z.object({ currentRefreshToken: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const exceptHash = hashToken(input.currentRefreshToken);
			const record =
				await context.services.stores.refreshToken.find(exceptHash);
			if (!record || record.userId !== context.authedUser.id) {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Invalid refresh token",
				});
			}
			await context.services.stores.refreshToken.revokeOthersForUser(
				context.authedUser.id,
				exceptHash
			);
			return { ok: true as const };
		}),

	setPassword: userProcedure
		.input(z.object({ password: z.string().min(8) }))
		.handler(async ({ input, context }) => {
			await context.services.stores.user.setPasswordHash(
				context.authedUser.id,
				hashPassword(input.password)
			);
			return { ok: true };
		}),
};
