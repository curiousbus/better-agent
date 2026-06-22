import type { AgentValidator } from "@better-agent/agent/agent/agent-validator";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { publicProcedure } from "../index";

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
	list: publicProcedure.handler(({ context }) =>
		context.services.stores.agent.list()
	),

	get: publicProcedure
		.input(idInput)
		.handler(({ input, context }) =>
			context.services.stores.agent.get(input.id)
		),

	create: publicProcedure
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
			});
			// Show-once: the plaintext token is returned only here, never persisted.
			return { ...agent, token };
		}),

	update: publicProcedure
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

	delete: publicProcedure.input(idInput).handler(async ({ input, context }) => {
		await context.services.stores.agent.delete(input.id);
		return { ok: true };
	}),
};
