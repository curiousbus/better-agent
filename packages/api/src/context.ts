import type { Context as HonoContext } from "hono";
import type { AgentServices } from "./services";

export interface CreateContextOptions {
	context: HonoContext;
	services: AgentServices;
}

// biome-ignore lint/suspicious/useAwait: context 工厂按约定为异步，便于后续接入 session/auth 查询
export async function createContext(options: CreateContextOptions) {
	return {
		services: options.services,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
