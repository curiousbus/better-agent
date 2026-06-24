import type { AgentConfig } from "@better-agent/agent/agent/types";
import type { User } from "@better-agent/agent/auth/types";
import type { Context as HonoContext } from "hono";
import type { AgentServices } from "./services";

export interface CreateContextOptions {
	context: HonoContext;
	services: AgentServices;
}

const BEARER_PREFIX = "Bearer ";

async function resolveAuthedAgent(
	options: CreateContextOptions
): Promise<AgentConfig | null> {
	const header = options.context.req.header("authorization");
	if (!header?.startsWith(BEARER_PREFIX)) {
		return null;
	}
	const token = header.slice(BEARER_PREFIX.length).trim();
	if (!token) {
		return null;
	}
	const { tokenService, stores } = options.services;
	if (!(tokenService && stores.agent)) {
		return null;
	}
	const hash = tokenService.hash(token);
	return await stores.agent.findByTokenHash(hash);
}

async function resolveAuthedUser(
	options: CreateContextOptions
): Promise<User | null> {
	const header = options.context.req.header("authorization");
	if (!header?.startsWith(BEARER_PREFIX)) {
		return null;
	}
	const token = header.slice(BEARER_PREFIX.length).trim();
	const { jwtService, stores } = options.services;
	if (!(jwtService && stores.user)) {
		return null;
	}
	const claims = await jwtService.verify(token);
	if (!claims) {
		return null;
	}
	return stores.user.findById(claims.sub);
}

export async function createContext(options: CreateContextOptions) {
	return {
		services: options.services,
		authedAgent: await resolveAuthedAgent(options),
		authedUser: await resolveAuthedUser(options),
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
