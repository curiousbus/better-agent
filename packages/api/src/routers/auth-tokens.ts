import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import { ORPCError } from "@orpc/server";
import type { Context } from "../context";

const MS_PER_SECOND = 1000;

// Mints an access + refresh token for a user. Called on every real sign-in
// (password login / magic verify / register) but NOT on token refresh — so it
// is the single place to record a "signed in" activity event.
export async function issueTokens(
	context: Context,
	user: { id: string; email: string }
) {
	const { authConfig, jwtService, stores } = context.services;
	// Single choke point for every token-minting path (password / magic link /
	// google / register / refresh): suspended accounts get nothing.
	const fresh = await stores.user.findById(user.id);
	if (fresh?.blocked) {
		throw new ORPCError("FORBIDDEN", {
			message: "Your account has been suspended",
		});
	}
	const accessToken = await jwtService.sign(
		{ sub: user.id, email: user.email },
		authConfig.accessTtl
	);
	const refreshToken = generateToken("rt_");
	await stores.refreshToken.create({
		userId: user.id,
		tokenHash: hashToken(refreshToken),
		expiresAt: new Date(Date.now() + authConfig.refreshTtl * MS_PER_SECOND),
		userAgent: context.userAgent,
	});
	await stores.activity.log({
		userId: user.id,
		type: "login",
		summary: "Signed in",
	});
	return { accessToken, refreshToken, user };
}
