import type { BridgeSessionRow } from "@better-agent/agent/ports";
import { ORPCError } from "@orpc/server";
import type { Context } from "../context";

// Loads a bridge session and asserts it belongs to `userId`. NOT_FOUND for
// both missing and other-owner sessions, so existence never leaks — same
// pattern as requireOwnedAgent / requireOwnedSession in the other routers.
export async function requireOwnedBridgeSession(
	context: Context,
	userId: string,
	sessionId: string
): Promise<BridgeSessionRow> {
	const session = await context.services.stores.bridgeSession.get(sessionId);
	if (!session || session.userId !== userId) {
		throw new ORPCError("NOT_FOUND", {
			message: `Bridge session ${sessionId} not found`,
		});
	}
	return session;
}
