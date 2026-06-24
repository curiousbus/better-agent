import type { RunEvent } from "@better-agent/agent/session/events";
import type { Session } from "@better-agent/agent/session/types";
import { buildRemoteToolDefs } from "@better-agent/agent/tool/remote-tools";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { userProcedure } from "../index";
import { drain, errorMessage } from "./sessions";

const idInput = z.object({ id: z.uuid() });
const sessionIdInput = z.object({ sessionId: z.uuid() });
const remoteToolSchema = z.object({
	name: z.string().min(1),
	description: z.string(),
	parameters: z.record(z.string(), z.unknown()),
});
const promptInput = z.object({
	sessionId: z.uuid(),
	text: z.string().min(1),
	tools: z.array(remoteToolSchema).optional(),
});

async function requireUserSession(
	context: Context,
	userId: string,
	sessionId: string
): Promise<Session> {
	const session = await context.services.stores.session.get(sessionId);
	if (!session || session.userId !== userId) {
		throw new ORPCError("NOT_FOUND", {
			message: `Session ${sessionId} not found`,
		});
	}
	return session;
}

async function* streamUserTurn(
	context: Context,
	userId: string,
	input: {
		sessionId: string;
		text: string;
		tools?: Array<{
			name: string;
			description: string;
			parameters: Record<string, unknown>;
		}>;
	},
	signal: AbortSignal | undefined
): AsyncGenerator<RunEvent, void> {
	try {
		await requireUserSession(context, userId, input.sessionId);
		const toolDefs = input.tools
			? buildRemoteToolDefs(input.tools, context.services.pendingToolCallStore)
			: undefined;
		yield* context.services.runtime.runTurn({
			sessionId: input.sessionId,
			text: input.text,
			tools: toolDefs,
			abortSignal: signal,
		});
	} catch (error) {
		yield { type: "error", message: errorMessage(error) };
	}
}

export const userSessionsRouter = {
	create: userProcedure
		.input(z.object({ agentId: z.uuid() }))
		.handler(async ({ input, context }) => {
			const agent = await context.services.stores.agent.get(input.agentId);
			if (!agent) {
				throw new ORPCError("NOT_FOUND", { message: "Agent not found" });
			}
			return context.services.stores.session.create({
				agentId: input.agentId,
				userId: context.authedUser.id,
			});
		}),

	list: userProcedure.handler(({ context }) =>
		context.services.stores.session.listByUser(context.authedUser.id)
	),

	get: userProcedure
		.input(idInput)
		.handler(({ input, context }) =>
			requireUserSession(context, context.authedUser.id, input.id)
		),

	listMessages: userProcedure
		.input(sessionIdInput)
		.handler(async ({ input, context }) => {
			await requireUserSession(context, context.authedUser.id, input.sessionId);
			return context.services.stores.message.listWithParts(input.sessionId);
		}),

	run: userProcedure
		.input(promptInput)
		.handler(async ({ input, context, signal }) => {
			await requireUserSession(context, context.authedUser.id, input.sessionId);
			const toolDefs = input.tools
				? buildRemoteToolDefs(
						input.tools,
						context.services.pendingToolCallStore
					)
				: undefined;
			return drain(
				context.services.runtime.runTurn({
					sessionId: input.sessionId,
					text: input.text,
					tools: toolDefs,
					abortSignal: signal,
				})
			);
		}),

	prompt: userProcedure
		.input(promptInput)
		.handler(({ input, context, signal }) =>
			streamUserTurn(context, context.authedUser.id, input, signal)
		),

	submitToolResult: userProcedure
		.input(
			z.object({
				sessionId: z.uuid(),
				callId: z.string().min(1),
				result: z.string(),
				isError: z.boolean().default(false),
			})
		)
		.handler(async ({ input, context }) => {
			await requireUserSession(context, context.authedUser.id, input.sessionId);
			await context.services.pendingToolCallStore.resolve({
				sessionId: input.sessionId,
				callId: input.callId,
				result: { output: input.result, isError: input.isError },
			});
			return { ok: true };
		}),
};
