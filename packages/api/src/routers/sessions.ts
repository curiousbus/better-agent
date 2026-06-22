import type { RunEvent } from "@better-agent/agent/session/events";
import type { Message } from "@better-agent/agent/session/types";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { agentProcedure, publicProcedure } from "../index";

const idInput = z.object({ id: z.uuid() });
const sessionIdInput = z.object({ sessionId: z.uuid() });
const promptInput = z.object({
	sessionId: z.uuid(),
	text: z.string().min(1),
});

// Loads the session and asserts it belongs to the authed agent. Returns
// NOT_FOUND for both missing and other-agent sessions so existence never leaks.
async function requireOwnedSession(
	context: Context,
	agentId: string,
	sessionId: string
): Promise<void> {
	const session = await context.services.stores.session.get(sessionId);
	if (!session || session.agentId !== agentId) {
		throw new ORPCError("NOT_FOUND", {
			message: `Session ${sessionId} not found`,
		});
	}
}

async function drain(gen: AsyncGenerator<RunEvent, Message>): Promise<Message> {
	let next = await gen.next();
	while (!next.done) {
		next = await gen.next();
	}
	return next.value;
}

function errorMessage(error: unknown): string {
	if (error instanceof ORPCError) {
		return error.message;
	}
	return error instanceof Error ? error.message : String(error);
}

/**
 * Run a turn as a stream of events. Any failure (missing/foreign session,
 * model/provider error, etc.) is delivered as a terminal `error` event rather
 * than thrown, so the HTTP stream always establishes (200) and the client can
 * read the reason — a throw out of a streaming handler yields a 500 with no
 * CORS header, which the browser masks as a CORS failure.
 */
async function* streamTurn(
	context: Context,
	agentId: string,
	input: { sessionId: string; text: string },
	signal: AbortSignal | undefined
): AsyncGenerator<RunEvent, void> {
	try {
		await requireOwnedSession(context, agentId, input.sessionId);
		yield* context.services.runtime.runTurn({
			sessionId: input.sessionId,
			text: input.text,
			abortSignal: signal,
		});
	} catch (error) {
		yield { type: "error", message: errorMessage(error) };
	}
}

export const sessionsRouter = {
	create: agentProcedure.handler(({ context }) =>
		context.services.stores.session.create({
			agentId: context.authedAgent.id,
		})
	),

	get: agentProcedure.input(idInput).handler(async ({ input, context }) => {
		await requireOwnedSession(context, context.authedAgent.id, input.id);
		return context.services.stores.session.get(input.id);
	}),

	list: publicProcedure.handler(({ context }) =>
		context.services.stores.session.list()
	),

	listMessages: agentProcedure
		.input(sessionIdInput)
		.handler(async ({ input, context }) => {
			await requireOwnedSession(
				context,
				context.authedAgent.id,
				input.sessionId
			);
			return context.services.stores.message.listWithParts(input.sessionId);
		}),

	run: agentProcedure
		.input(promptInput)
		.handler(async ({ input, context, signal }) => {
			await requireOwnedSession(
				context,
				context.authedAgent.id,
				input.sessionId
			);
			return drain(
				context.services.runtime.runTurn({
					sessionId: input.sessionId,
					text: input.text,
					abortSignal: signal,
				})
			);
		}),

	prompt: agentProcedure
		.input(promptInput)
		.handler(({ input, context, signal }) =>
			streamTurn(context, context.authedAgent.id, input, signal)
		),
};
