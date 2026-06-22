import type { AgentConfig } from "@better-agent/agent/agent/types";
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
	const hash = options.services.tokenService.hash(token);
	return await options.services.stores.agent.findByTokenHash(hash);
}

export async function createContext(options: CreateContextOptions) {
	return {
		services: options.services,
		authedAgent: await resolveAuthedAgent(options),
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
