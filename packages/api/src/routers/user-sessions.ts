import type { RunEvent } from "@better-agent/agent/session/events";
import type { Session } from "@better-agent/agent/session/types";
import { buildBuiltinToolDefs } from "@better-agent/agent/tool/builtin-tools";
import {
	buildComposioToolDefs,
	type ComposioService,
} from "@better-agent/agent/tool/composio-tools";
import { buildRemoteToolDefs } from "@better-agent/agent/tool/remote-tools";
import { buildSprintToolDefs } from "@better-agent/agent/tool/sprint-tools";
import { buildTaskToolDefs } from "@better-agent/agent/tool/task-tools";
import type { ToolDef } from "@better-agent/agent/tool/types";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import {
	attachmentIdInput,
	bytesToFile,
	uploadAttachmentInput,
	validateImageUpload,
} from "../attachments";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";
import {
	drainWithStructured,
	errorMessage,
	promptInput,
	promptOrToolCallsInput,
} from "./sessions";
import {
	executeToolCall,
	streamSettled,
	type ToolCall,
} from "./tool-calls-stream";

const idInput = z.object({ id: z.uuid() });
const sessionIdInput = z.object({ sessionId: z.uuid() });

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

// Destructive board tools are kept OUT of the natural-language model turn — a
// vague command shouldn't be able to delete a task or end a sprint. They remain
// available on the direct (button-driven) toolCalls path.
const NL_UNSAFE_TOOLS = new Set([
	"deleteTask",
	"deleteSprint",
	"completeSprint",
]);

function boardModelDefs(context: Context, userId: string): ToolDef[] {
	return [
		...buildTaskToolDefs(context.services.stores.task, userId),
		...buildSprintToolDefs(context.services.stores.sprint, userId),
	].filter((def) => !NL_UNSAFE_TOOLS.has(def.name));
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
		attachmentIds?: string[];
		surfaces?: string[];
	},
	signal: AbortSignal | undefined
): AsyncGenerator<RunEvent, void> {
	try {
		const session = await requireUserSession(context, userId, input.sessionId);
		const remoteDefs = input.tools
			? buildRemoteToolDefs(input.tools, context.services.pendingToolCallStore)
			: [];
		const toolDefs = await agentToolDefs(context, session.agentId);
		// Board tools are bound ONLY when the turn opts into the board surface, and
		// only the non-destructive subset.
		const boardDefs = input.surfaces?.includes("board")
			? boardModelDefs(context, userId)
			: [];
		const allDefs = [...remoteDefs, ...toolDefs, ...boardDefs];
		yield* context.services.runtime.runTurn({
			sessionId: input.sessionId,
			text: input.text,
			tools: allDefs.length > 0 ? allDefs : undefined,
			outputSchema: input.outputSchema,
			attachmentIds: input.attachmentIds,
			abortSignal: signal,
		});
	} catch (error) {
		yield { type: "error", message: errorMessage(error) };
	}
}

// Direct tool execution over the SAME stream: run the named task tools
// concurrently with no model, yielding each result the instant it resolves.
async function* streamToolCalls(
	context: Context,
	userId: string,
	input: { sessionId: string; toolCalls: ToolCall[] },
	signal: AbortSignal | undefined
): AsyncGenerator<RunEvent, void> {
	try {
		await requireUserSession(context, userId, input.sessionId);
		const defs = [
			...buildTaskToolDefs(context.services.stores.task, userId),
			...buildSprintToolDefs(context.services.stores.sprint, userId),
		];
		const byName = new Map(defs.map((def) => [def.name, def] as const));
		const work = input.toolCalls.map((call) =>
			executeToolCall(byName.get(call.name), call, input.sessionId, signal)
		);
		yield* streamSettled(work);
		yield { type: "done", usage: null, finishReason: "stop" };
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

	uploadAttachment: authorizedUserProcedure
		.input(uploadAttachmentInput)
		.handler(async ({ input, context }) => {
			await requireUserSession(context, context.authedUser.id, input.sessionId);
			const validated = await validateImageUpload(input.file);
			const row = await context.services.stores.attachment.create({
				sessionId: input.sessionId,
				data: validated.data,
				mime: validated.mime,
				name: validated.name,
			});
			return { id: row.id, mime: row.mime, name: row.name, size: row.size };
		}),

	getAttachment: authorizedUserProcedure
		.input(attachmentIdInput)
		.handler(async ({ input, context }) => {
			const row = await context.services.stores.attachment.getById(input.id);
			if (!row) {
				throw new ORPCError("NOT_FOUND", { message: "Attachment not found" });
			}
			await requireUserSession(context, context.authedUser.id, row.sessionId);
			const bytes = await context.services.stores.attachment.getBytes(input.id);
			if (!bytes) {
				throw new ORPCError("NOT_FOUND", { message: "Attachment not found" });
			}
			return bytesToFile(bytes, row.name, row.mime);
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
					attachmentIds: input.attachmentIds,
					abortSignal: signal,
				})
			);
		}),

	prompt: authorizedUserProcedure
		.input(promptOrToolCallsInput)
		.handler(({ input, context, signal }) => {
			if ("toolCalls" in input) {
				return streamToolCalls(context, context.authedUser.id, input, signal);
			}
			return streamUserTurn(context, context.authedUser.id, input, signal);
		}),

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
