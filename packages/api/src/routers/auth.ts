import { isAdminEmail } from "@better-agent/agent/auth/admin";
import type { RateLimiter } from "@better-agent/agent/auth/rate-limiter";
import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { publicProcedure, userProcedure } from "../index";

const MS = 1000;

const RATE_WINDOW_MS = 15 * 60 * 1000;
const LIMIT_LINK_EMAIL = 5;
const LIMIT_LINK_IP = 20;
const LIMIT_VERIFY_IP = 10;
const LIMIT_REFRESH_IP = 30;

async function enforce(
	limiter: RateLimiter,
	key: string,
	limit: number
): Promise<void> {
	if (!(await limiter.hit(key, limit, RATE_WINDOW_MS))) {
		throw new ORPCError("TOO_MANY_REQUESTS", {
			message: "Too many requests. Try again later.",
		});
	}
}

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
		userAgent: context.userAgent,
	});
	return { accessToken, refreshToken, user };
}

export const authRouter = {
	requestLink: publicProcedure
		.input(
			z.object({
				email: z.email(),
				audience: z.enum(["web", "admin"]).default("web"),
			})
		)
		.handler(async ({ input, context }) => {
			const limiter = context.services.rateLimiter;
			await enforce(limiter, `link:ip:${context.clientIp}`, LIMIT_LINK_IP);
			await enforce(limiter, `link:email:${input.email}`, LIMIT_LINK_EMAIL);
			const { authConfig, emailSender, stores } = context.services;
			const token = generateToken("ml_");
			await stores.magicLink.create({
				tokenHash: hashToken(token),
				email: input.email,
				expiresAt: new Date(Date.now() + authConfig.magicLinkTtl * MS),
			});
			const base =
				input.audience === "admin" ? authConfig.adminUrl : authConfig.webUrl;
			const url = `${base}/auth/verify?token=${token}`;
			await emailSender.sendMagicLink({ email: input.email, url });
			return { ok: true };
		}),

	verify: publicProcedure
		.input(z.object({ token: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			await enforce(
				context.services.rateLimiter,
				`verify:ip:${context.clientIp}`,
				LIMIT_VERIFY_IP
			);
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
			await enforce(
				context.services.rateLimiter,
				`refresh:ip:${context.clientIp}`,
				LIMIT_REFRESH_IP
			);
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

	me: userProcedure.handler(({ context }) => ({
		...context.authedUser,
		isAdmin: isAdminEmail(
			context.authedUser.email,
			context.services.authConfig.adminEmails
		),
	})),

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
