import type { RunEvent } from "@better-agent/agent/session/events";
import type { Session } from "@better-agent/agent/session/types";
import { buildBuiltinToolDefs } from "@better-agent/agent/tool/builtin-tools";
import {
	buildComposioToolDefs,
	type ComposioService,
} from "@better-agent/agent/tool/composio-tools";
import { buildRemoteToolDefs } from "@better-agent/agent/tool/remote-tools";
import type { ToolDef } from "@better-agent/agent/tool/types";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";
import { drainWithStructured, errorMessage } from "./sessions";

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
	outputSchema: z.record(z.string(), z.unknown()).optional(),
});

// `scope` is the composio "user" scope — here a composio account id. Builds the
// tool defs for every authenticated toolkit of that account.
export async function safeComposioDefs(
	service: ComposioService | null,
	scope: string
): Promise<ToolDef[]> {
	if (!service) {
		return [];
	}
	try {
		const connections = await service.listConnections(scope);
		const toolkits = [
			...new Set(connections.filter((c) => c.active).map((c) => c.toolkitSlug)),
		];
		if (toolkits.length === 0) {
			return [];
		}
		return await buildComposioToolDefs(service, scope, toolkits);
	} catch {
		return [];
	}
}

// An agent's tools: every authenticated toolkit of each linked composio account,
// plus its enabled built-in tools.
async function agentToolDefs(
	context: Context,
	agentId: string
): Promise<ToolDef[]> {
	const agent = await context.services.stores.agent.get(agentId);
	if (!agent) {
		return [];
	}
	const perAccount = await Promise.all(
		(agent.composioAccountIds ?? []).map(async (accountId) => {
			const service = await context.services.composio(accountId);
			return safeComposioDefs(service, accountId);
		})
	);
	return [
		...perAccount.flat(),
		...buildBuiltinToolDefs(agent.builtinTools ?? []),
	];
}

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
		outputSchema?: Record<string, unknown>;
	},
	signal: AbortSignal | undefined
): AsyncGenerator<RunEvent, void> {
	try {
		const session = await requireUserSession(context, userId, input.sessionId);
		const remoteDefs = input.tools
			? buildRemoteToolDefs(input.tools, context.services.pendingToolCallStore)
			: [];
		const toolDefs = await agentToolDefs(context, session.agentId);
		const allDefs = [...remoteDefs, ...toolDefs];
		yield* context.services.runtime.runTurn({
			sessionId: input.sessionId,
			text: input.text,
			tools: allDefs.length > 0 ? allDefs : undefined,
			outputSchema: input.outputSchema,
			abortSignal: signal,
		});
	} catch (error) {
		yield { type: "error", message: errorMessage(error) };
	}
}

export const userSessionsRouter = {
	create: authorizedUserProcedure
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

	list: authorizedUserProcedure.handler(({ context }) =>
		context.services.stores.session.listByUser(context.authedUser.id)
	),

	get: authorizedUserProcedure
		.input(idInput)
		.handler(({ input, context }) =>
			requireUserSession(context, context.authedUser.id, input.id)
		),

	listMessages: authorizedUserProcedure
		.input(sessionIdInput)
		.handler(async ({ input, context }) => {
			await requireUserSession(context, context.authedUser.id, input.sessionId);
			return context.services.stores.message.listWithParts(input.sessionId);
		}),

	run: authorizedUserProcedure
		.input(promptInput)
		.handler(async ({ input, context, signal }) => {
			await requireUserSession(context, context.authedUser.id, input.sessionId);
			const toolDefs = input.tools
				? buildRemoteToolDefs(
						input.tools,
						context.services.pendingToolCallStore
					)
				: undefined;
			return drainWithStructured(
				context.services.runtime.runTurn({
					sessionId: input.sessionId,
					text: input.text,
					tools: toolDefs,
					outputSchema: input.outputSchema,
					abortSignal: signal,
				})
			);
		}),

	prompt: authorizedUserProcedure
		.input(promptInput)
		.handler(({ input, context, signal }) =>
			streamUserTurn(context, context.authedUser.id, input, signal)
		),

	cancel: authorizedUserProcedure
		.input(sessionIdInput)
		.handler(async ({ input, context }) => {
			await requireUserSession(context, context.authedUser.id, input.sessionId);
			await context.services.cancellation.cancel(input.sessionId);
			return { ok: true };
		}),

	submitToolResult: authorizedUserProcedure
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
