import type { RunEvent } from "@better-agent/agent/session/events";
import type { Message } from "@better-agent/agent/session/types";
import { buildRemoteToolDefs } from "@better-agent/agent/tool/remote-tools";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import {
	attachmentIdInput,
	bytesToFile,
	uploadAttachmentInput,
	validateImageUpload,
} from "../attachments";
import type { Context } from "../context";
import { adminProcedure, agentProcedure } from "../index";

const idInput = z.object({ id: z.uuid() });
const sessionIdInput = z.object({ sessionId: z.uuid() });
const remoteToolSchema = z.object({
	name: z.string().min(1),
	description: z.string(),
	parameters: z.record(z.string(), z.unknown()),
});

const MAX_ATTACHMENTS = 10;

export const promptInput = z
	.object({
		sessionId: z.uuid(),
		text: z.string(),
		tools: z.array(remoteToolSchema).optional(),
		outputSchema: z.record(z.string(), z.unknown()).optional(),
		attachmentIds: z.array(z.uuid()).max(MAX_ATTACHMENTS).optional(),
	})
	.refine(
		(value) =>
			value.text.trim().length > 0 || (value.attachmentIds?.length ?? 0) > 0,
		{ message: "Provide a message or at least one attachment" }
	);

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

export async function drain(
	gen: AsyncGenerator<RunEvent, Message>
): Promise<Message> {
	let next = await gen.next();
	while (!next.done) {
		next = await gen.next();
	}
	return next.value;
}

export async function drainWithStructured(
	gen: AsyncGenerator<RunEvent, Message>
): Promise<Message & { structured: unknown }> {
	let structured: unknown = null;
	let next = await gen.next();
	while (!next.done) {
		if (next.value.type === "done") {
			structured = next.value.structured ?? null;
		}
		next = await gen.next();
	}
	return { ...next.value, structured };
}

export function errorMessage(error: unknown): string {
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
	},
	signal: AbortSignal | undefined
): AsyncGenerator<RunEvent, void> {
	try {
		await requireOwnedSession(context, agentId, input.sessionId);
		const toolDefs = input.tools
			? buildRemoteToolDefs(input.tools, context.services.pendingToolCallStore)
			: undefined;
		yield* context.services.runtime.runTurn({
			sessionId: input.sessionId,
			text: input.text,
			tools: toolDefs,
			outputSchema: input.outputSchema,
			attachmentIds: input.attachmentIds,
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

	list: adminProcedure
		.input(z.object({ agentId: z.uuid() }))
		.handler(({ input, context }) =>
			context.services.stores.session.listByAgent(input.agentId)
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

	uploadAttachment: agentProcedure
		.input(uploadAttachmentInput)
		.handler(async ({ input, context }) => {
			await requireOwnedSession(
				context,
				context.authedAgent.id,
				input.sessionId
			);
			const validated = await validateImageUpload(input.file);
			const row = await context.services.stores.attachment.create({
				sessionId: input.sessionId,
				data: validated.data,
				mime: validated.mime,
				name: validated.name,
			});
			return { id: row.id, mime: row.mime, name: row.name, size: row.size };
		}),

	getAttachment: agentProcedure
		.input(attachmentIdInput)
		.handler(async ({ input, context }) => {
			const row = await context.services.stores.attachment.getById(input.id);
			if (!row) {
				throw new ORPCError("NOT_FOUND", { message: "Attachment not found" });
			}
			await requireOwnedSession(context, context.authedAgent.id, row.sessionId);
			const bytes = await context.services.stores.attachment.getBytes(input.id);
			if (!bytes) {
				throw new ORPCError("NOT_FOUND", { message: "Attachment not found" });
			}
			return bytesToFile(bytes, row.name, row.mime);
		}),

	run: agentProcedure
		.input(promptInput)
		.handler(async ({ input, context, signal }) => {
			await requireOwnedSession(
				context,
				context.authedAgent.id,
				input.sessionId
			);
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

	prompt: agentProcedure
		.input(promptInput)
		.handler(({ input, context, signal }) =>
			streamTurn(context, context.authedAgent.id, input, signal)
		),

	cancel: agentProcedure
		.input(sessionIdInput)
		.handler(async ({ input, context }) => {
			await requireOwnedSession(
				context,
				context.authedAgent.id,
				input.sessionId
			);
			await context.services.cancellation.cancel(input.sessionId);
			return { ok: true };
		}),

	submitToolResult: agentProcedure
		.input(
			z.object({
				sessionId: z.uuid(),
				callId: z.string().min(1),
				result: z.string(),
				isError: z.boolean().default(false),
			})
		)
		.handler(async ({ input, context }) => {
			await requireOwnedSession(
				context,
				context.authedAgent.id,
				input.sessionId
			);
			await context.services.pendingToolCallStore.resolve({
				sessionId: input.sessionId,
				callId: input.callId,
				result: { output: input.result, isError: input.isError },
			});
			return { ok: true };
		}),
};
