import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import { z } from "zod";
import { requireOwnedBridgeSession } from "../bridge/ownership";
import { bridgeProcedure, userProcedure } from "../index";

const TOKEN_PREFIX = "bt_";
const LAST4 = 4;
const AGENT_KINDS = ["claude-code", "opencode", "codex"] as const;

const idInput = z.object({ id: z.uuid() });
const sessionIdInput = z.object({ sessionId: z.uuid() });
const pollInput = z.object({
	sessionId: z.uuid(),
	afterId: z.number().int().min(0),
});

export const bridgeRouter = {
	// --- user-facing bridge-token management ---
	createToken: userProcedure
		.input(z.object({ name: z.string().min(1).optional() }))
		.handler(async ({ input, context }) => {
			const token = generateToken(TOKEN_PREFIX);
			await context.services.stores.bridgeToken.create({
				userId: context.authedUser.id,
				name: input.name,
				tokenHash: hashToken(token),
				last4: token.slice(-LAST4),
			});
			return { token, last4: token.slice(-LAST4) };
		}),

	listTokens: userProcedure.handler(({ context }) =>
		context.services.stores.bridgeToken.listByUser(context.authedUser.id)
	),

	revokeToken: userProcedure
		.input(idInput)
		.handler(async ({ input, context }) => {
			await context.services.stores.bridgeToken.revoke(
				input.id,
				context.authedUser.id
			);
			return { ok: true };
		}),

	// --- bridge-token (local CLI) endpoints ---
	startSession: bridgeProcedure
		.input(
			z.object({
				agentKind: z.enum(AGENT_KINDS),
				label: z.string().min(1).optional(),
			})
		)
		.handler(async ({ input, context }) => {
			const { userId, tokenId } = context.authedBridgeToken;
			const session = await context.services.stores.bridgeSession.create({
				userId,
				tokenId,
				agentKind: input.agentKind,
				label: input.label,
			});
			return { sessionId: session.id };
		}),

	pushEvents: bridgeProcedure
		.input(z.object({ sessionId: z.uuid(), events: z.array(z.unknown()) }))
		.handler(async ({ input, context }) => {
			await requireOwnedBridgeSession(
				context,
				context.authedBridgeToken.userId,
				input.sessionId
			);
			for (const event of input.events) {
				await context.services.relayStore.append(
					input.sessionId,
					"events",
					event
				);
			}
			await context.services.stores.bridgeSession.touch(input.sessionId);
			return { ok: true };
		}),

	pollCommands: bridgeProcedure
		.input(pollInput)
		.handler(async ({ input, context }) => {
			await requireOwnedBridgeSession(
				context,
				context.authedBridgeToken.userId,
				input.sessionId
			);
			return context.services.relayStore.read(
				input.sessionId,
				"commands",
				input.afterId
			);
		}),

	// --- web (user) endpoints ---
	observe: userProcedure
		.input(pollInput)
		.handler(async ({ input, context }) => {
			await requireOwnedBridgeSession(
				context,
				context.authedUser.id,
				input.sessionId
			);
			return context.services.relayStore.read(
				input.sessionId,
				"events",
				input.afterId
			);
		}),

	sendInput: userProcedure
		.input(z.object({ sessionId: z.uuid(), data: z.unknown() }))
		.handler(async ({ input, context }) => {
			await requireOwnedBridgeSession(
				context,
				context.authedUser.id,
				input.sessionId
			);
			await context.services.relayStore.append(
				input.sessionId,
				"commands",
				input.data
			);
			return { ok: true };
		}),

	listSessions: userProcedure.handler(({ context }) =>
		context.services.stores.bridgeSession.listByUser(context.authedUser.id)
	),

	endSession: userProcedure
		.input(sessionIdInput)
		.handler(async ({ input, context }) => {
			await requireOwnedBridgeSession(
				context,
				context.authedUser.id,
				input.sessionId
			);
			await context.services.stores.bridgeSession.end(
				input.sessionId,
				context.authedUser.id
			);
			return { ok: true };
		}),
};
