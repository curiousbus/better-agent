import type { AgentValidator } from "@better-agent/agent/agent/agent-validator";
import type { AgentConfig } from "@better-agent/agent/agent/types";
import type {
	AgentStore,
	ComposioAccountStore,
} from "@better-agent/agent/ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { authorizedUserProcedure } from "../index";

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

// A user may only wire THEIR OWN composio accounts into an agent — linking a
// foreign account id would let them use someone else's key and connections.
async function assertOwnedComposioAccounts(
	store: ComposioAccountStore,
	userId: string,
	ids: string[]
): Promise<void> {
	if (ids.length === 0) {
		return;
	}
	const owned = new Set(
		(await store.listByUser(userId)).map((account) => account.id)
	);
	if (ids.some((id) => !owned.has(id))) {
		throw new ORPCError("BAD_REQUEST", {
			message: "You can only link your own Composio accounts",
		});
	}
}

// Loads an agent and asserts the caller owns it. NOT_FOUND for both missing and
// other-owner agents, so ownership never leaks.
async function requireOwnedAgent(
	store: AgentStore,
	userId: string,
	id: string
): Promise<AgentConfig> {
	const agent = await store.get(id);
	if (!agent || agent.userId !== userId) {
		throw new ORPCError("NOT_FOUND", { message: `Agent ${id} not found` });
	}
	return agent;
}

export const agentsRouter = {
	list: authorizedUserProcedure.handler(({ context }) =>
		context.services.stores.agent.listByUser(context.authedUser.id)
	),

	get: authorizedUserProcedure
		.input(idInput)
		.handler(({ input, context }) =>
			requireOwnedAgent(
				context.services.stores.agent,
				context.authedUser.id,
				input.id
			)
		),

	// Returns the agent's current token so its owner can reuse it for chat.
	getToken: authorizedUserProcedure
		.input(idInput)
		.handler(async ({ input, context }) => {
			await requireOwnedAgent(
				context.services.stores.agent,
				context.authedUser.id,
				input.id
			);
			return context.services.stores.agent.getToken(input.id);
		}),

	create: authorizedUserProcedure
		.input(agentInput)
		.handler(async ({ input, context }) => {
			await assertValidAgent(context.services.agentValidator, {
				providerId: input.providerId,
				modelId: input.modelId,
			});
			await assertOwnedComposioAccounts(
				context.services.stores.composioAccount,
				context.authedUser.id,
				input.composioAccountIds
			);
			const { token, hash } = context.services.tokenService.generate();
			const agent = await context.services.stores.agent.create({
				...input,
				tokenHash: hash,
				token,
				userId: context.authedUser.id,
			});
			await context.services.stores.activity.log({
				userId: context.authedUser.id,
				type: "agent_created",
				summary: `Created agent “${agent.name}”`,
			});
			return { agent, token };
		}),

	rotateToken: authorizedUserProcedure
		.input(idInput)
		.handler(async ({ input, context }) => {
			await requireOwnedAgent(
				context.services.stores.agent,
				context.authedUser.id,
				input.id
			);
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

	update: authorizedUserProcedure
		.input(idInput.extend(agentInput.shape))
		.handler(async ({ input, context }) => {
			const { id, ...rest } = input;
			await requireOwnedAgent(
				context.services.stores.agent,
				context.authedUser.id,
				id
			);
			await assertValidAgent(context.services.agentValidator, {
				providerId: rest.providerId,
				modelId: rest.modelId,
			});
			await assertOwnedComposioAccounts(
				context.services.stores.composioAccount,
				context.authedUser.id,
				rest.composioAccountIds
			);
			const updated = await context.services.stores.agent.update(id, rest);
			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: `Agent ${id} not found` });
			}
			return updated;
		}),

	delete: authorizedUserProcedure
		.input(idInput)
		.handler(async ({ input, context }) => {
			const agent = await requireOwnedAgent(
				context.services.stores.agent,
				context.authedUser.id,
				input.id
			);
			await context.services.stores.agent.delete(input.id);
			await context.services.stores.activity.log({
				userId: context.authedUser.id,
				type: "agent_deleted",
				summary: `Deleted agent “${agent.name}”`,
			});
			return { ok: true };
		}),
};
