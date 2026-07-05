import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import { ORPCError } from "@orpc/server";
import { log } from "evlog";
import { z } from "zod";
import { requireOwnedBridgeSession } from "../bridge/ownership";
import type { Context } from "../context";
import { bridgeProcedure, userProcedure } from "../index";

const TOKEN_PREFIX = "bt_";
const LAST4 = 4;
const AGENT_KINDS = ["claude-code", "opencode", "codex", "pi"] as const;
/** Max events accepted in a single pushEvents call (spec §3.1: bounded window). */
const MAX_PUSH_BATCH = 50;
/** Max serialized size (bytes) of a single pushed event before it's rejected.
 * Mirrored in `apps/bridge-cli/src/truncate-event.ts`'s `MAX_EVENT_BYTES` —
 * the CLI truncates event fields down to (comfortably) under this same cap
 * before ever sending an event here, so real oversized batches shouldn't
 * happen in practice. Keep the two values in sync. */
const MAX_EVENT_BYTES = 32_768;
/** Max size (characters) of sendInput's `data` before it's rejected. */
const MAX_INPUT_CHARS = 8192;
/** Appended to a session's `commands↓` by `endSession`, so the CLI's poll
 * loop (see `apps/bridge-cli/src/commands.ts`'s `parseCommandText`) tells the
 * local agent process to stop instead of the DB flip alone leaving it running
 * forever. */
const STOP_CONTROL_COMMAND = { type: "control", action: "stop" } as const;
/** Default page size for the `history` endpoint when `limit` is omitted. */
const DEFAULT_HISTORY_LIMIT = 500;
/** Hard cap on `history`'s `limit` input, to bound one query's result size. */
const MAX_HISTORY_LIMIT = 500;

/** Serialized size of `value` in UTF-8 bytes, as JSON. */
function byteSizeOf(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

/** Serialized size of `value` in characters: raw length for a string,
 * JSON length otherwise. */
function charSizeOf(value: unknown): number {
	if (typeof value === "string") {
		return value.length;
	}
	return (JSON.stringify(value) ?? "").length;
}

/** Rejects the whole call with BAD_REQUEST naming the first oversized event,
 * rather than silently truncating — real line-truncation belongs in the
 * CLI's adapters, which know how to shrink an event without corrupting it. */
function assertEventsWithinSizeLimit(events: readonly unknown[]): void {
	for (const [index, event] of events.entries()) {
		if (byteSizeOf(event) > MAX_EVENT_BYTES) {
			throw new ORPCError("BAD_REQUEST", {
				message: `Event at index ${index} exceeds ${MAX_EVENT_BYTES} bytes`,
			});
		}
	}
}

function assertInputWithinSizeLimit(data: unknown): void {
	if (charSizeOf(data) > MAX_INPUT_CHARS) {
		throw new ORPCError("BAD_REQUEST", {
			message: `sendInput data exceeds ${MAX_INPUT_CHARS} characters`,
		});
	}
}

const idInput = z.object({ id: z.uuid() });
const sessionIdInput = z.object({ sessionId: z.uuid() });
const pollInput = z.object({
	sessionId: z.uuid(),
	afterId: z.number().int().min(0),
});
const historyInput = z.object({
	sessionId: z.uuid(),
	afterSeq: z.number().int().min(0).default(0),
	limit: z
		.number()
		.int()
		.min(1)
		.max(MAX_HISTORY_LIMIT)
		.default(DEFAULT_HISTORY_LIMIT),
});

/** Best-effort persistence of one relayed event under the relay's own
 * SERVER-assigned seq — a failure here must never break the live relay
 * (the CLI/web still get the event via pollCommands/observe), so it's
 * logged and swallowed rather than thrown. */
async function persistEventBestEffort(
	context: Context,
	sessionId: string,
	seq: number,
	event: unknown
): Promise<void> {
	try {
		await context.services.stores.bridgeMessage.append(sessionId, seq, event);
	} catch (err) {
		log.error({ action: "bridge pushEvents persist", error: String(err) });
	}
}

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
		.input(
			z.object({
				sessionId: z.uuid(),
				events: z.array(z.unknown()).max(MAX_PUSH_BATCH),
			})
		)
		.handler(async ({ input, context }) => {
			await requireOwnedBridgeSession(
				context,
				context.authedBridgeToken.userId,
				input.sessionId
			);
			assertEventsWithinSizeLimit(input.events);
			for (const event of input.events) {
				const seq = await context.services.relayStore.append(
					input.sessionId,
					"events",
					event
				);
				await persistEventBestEffort(context, input.sessionId, seq, event);
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

	/** Persisted event history for a session, seeded on page load before the
	 * web switches to live `observe` polling. Shares seq numbering with
	 * `observe`'s relay ids so the caller can dedupe replayed-then-live
	 * events. */
	history: userProcedure
		.input(historyInput)
		.handler(async ({ input, context }) => {
			await requireOwnedBridgeSession(
				context,
				context.authedUser.id,
				input.sessionId
			);
			return context.services.stores.bridgeMessage.list(
				input.sessionId,
				input.afterSeq,
				input.limit
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
			assertInputWithinSizeLimit(input.data);
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
			try {
				// Best-effort: the DB flip above is authoritative for "ended", so a
				// transient relay failure here must not fail the call — otherwise the
				// UI would see an error, keep showing the End button as if nothing
				// happened, yet the DB already reads "ended" and a retry can never
				// re-send the stop, leaving the local agent running forever. The CLI
				// will still notice the session ended via its own polling/error
				// handling even without this control command.
				await context.services.relayStore.append(
					input.sessionId,
					"commands",
					STOP_CONTROL_COMMAND
				);
			} catch {
				// swallow — see comment above.
			}
			return { ok: true };
		}),
};
