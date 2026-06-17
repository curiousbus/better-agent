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
			const error = await context.services.agentValidator.validate(input);
			if (error) {
				throw new ORPCError("BAD_REQUEST", { message: error });
			}
			return context.services.stores.agent.create(input);
		}),

	update: publicProcedure
		.input(idInput.extend(agentInput.shape))
		.handler(async ({ input, context }) => {
			const { id, ...rest } = input;
			const error = await context.services.agentValidator.validate(rest);
			if (error) {
				throw new ORPCError("BAD_REQUEST", { message: error });
			}
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
