import type { AgentValidator } from "@better-agent/agent/agent/agent-validator";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { adminProcedure, userProcedure } from "../index";

const paramsInput = z.object({
	temperature: z.number().min(0).max(2).nullable().default(null),
	topP: z.number().min(0).max(1).nullable().default(null),
	maxOutputTokens: z.number().int().positive().nullable().default(null),
});

const agentInput = z.object({
	name: z.string().min(1),
	description: z.string().min(1),
	systemPrompt: z.string().min(1),
	providerId: z.string().min(1),
	modelId: z.string().min(1),
	params: paramsInput.nullable().default(null),
	composioAccountIds: z.array(z.uuid()).default([]),
	builtinTools: z.array(z.string()).default([]),
});

const idInput = z.object({ id: z.uuid() });

async function assertValidAgent(
	validator: AgentValidator,
	input: { providerId: string; modelId: string }
): Promise<void> {
	const error = await validator.validate(input);
	if (error) {
		throw new ORPCError("BAD_REQUEST", { message: error });
	}
}

export const agentsRouter = {
	list: userProcedure.handler(({ context }) =>
		context.services.stores.agent.list()
	),

	get: adminProcedure
		.input(idInput)
		.handler(({ input, context }) =>
			context.services.stores.agent.get(input.id)
		),

	// Returns the agent's current token so a trusted caller (the admin UI) can
	// reuse it for chat instead of relying on a show-once copy.
	getToken: adminProcedure
		.input(idInput)
		.handler(({ input, context }) =>
			context.services.stores.agent.getToken(input.id)
		),

	create: adminProcedure
		.input(agentInput)
		.handler(async ({ input, context }) => {
			await assertValidAgent(context.services.agentValidator, {
				providerId: input.providerId,
				modelId: input.modelId,
			});
			const { token, hash } = context.services.tokenService.generate();
			const agent = await context.services.stores.agent.create({
				...input,
				tokenHash: hash,
				token,
			});
			return { agent, token };
		}),

	rotateToken: adminProcedure
		.input(idInput)
		.handler(async ({ input, context }) => {
			const { token, hash } = context.services.tokenService.generate();
			const agent = await context.services.stores.agent.rotateToken(
				input.id,
				hash,
				token
			);
			if (!agent) {
				throw new ORPCError("NOT_FOUND", {
					message: `Agent ${input.id} not found`,
				});
			}
			return { agent, token };
		}),

	update: adminProcedure
		.input(idInput.extend(agentInput.shape))
		.handler(async ({ input, context }) => {
			const { id, ...rest } = input;
			await assertValidAgent(context.services.agentValidator, {
				providerId: rest.providerId,
				modelId: rest.modelId,
			});
			const updated = await context.services.stores.agent.update(id, rest);
			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: `Agent ${id} not found` });
			}
			return updated;
		}),

	delete: adminProcedure.input(idInput).handler(async ({ input, context }) => {
		await context.services.stores.agent.delete(input.id);
		return { ok: true };
	}),
};
