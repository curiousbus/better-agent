import type { RunEvent } from "@better-agent/agent/session/events";
import type { Message } from "@better-agent/agent/session/types";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { publicProcedure } from "../index";

const createInput = z.object({ agentId: z.uuid() });
const idInput = z.object({ id: z.uuid() });
const sessionIdInput = z.object({ sessionId: z.uuid() });
const promptInput = z.object({
	sessionId: z.uuid(),
	text: z.string().min(1),
});

async function requireSession(
	context: Context,
	sessionId: string
): Promise<void> {
	const session = await context.services.stores.session.get(sessionId);
	if (!session) {
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
 * Run a turn as a stream of events. Any failure (missing session, model/
 * provider error, etc.) is delivered as a terminal `error` event rather than
 * thrown, so the HTTP stream always establishes (200) and the client can read
 * the reason — a throw out of a streaming handler yields a 500 with no CORS
 * header, which the browser masks as a CORS failure.
 */
async function* streamTurn(
	context: Context,
	input: { sessionId: string; text: string },
	signal: AbortSignal | undefined
): AsyncGenerator<RunEvent, void> {
	try {
		await requireSession(context, input.sessionId);
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
	create: publicProcedure
		.input(createInput)
		.handler(async ({ input, context }) => {
			const agent = await context.services.stores.agent.get(input.agentId);
			if (!agent) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Agent ${input.agentId} not found`,
				});
			}
			return context.services.stores.session.create({ agentId: input.agentId });
		}),

	get: publicProcedure
		.input(idInput)
		.handler(({ input, context }) =>
			context.services.stores.session.get(input.id)
		),

	list: publicProcedure.handler(({ context }) =>
		context.services.stores.session.list()
	),

	listMessages: publicProcedure
		.input(sessionIdInput)
		.handler(({ input, context }) =>
			context.services.stores.message.listWithParts(input.sessionId)
		),

	run: publicProcedure
		.input(promptInput)
		.handler(async ({ input, context, signal }) => {
			await requireSession(context, input.sessionId);
			return drain(
				context.services.runtime.runTurn({
					sessionId: input.sessionId,
					text: input.text,
					abortSignal: signal,
				})
			);
		}),

	prompt: publicProcedure
		.input(promptInput)
		.handler(({ input, context, signal }) =>
			streamTurn(context, input, signal)
		),
};
