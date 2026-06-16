import type { Context as HonoContext } from "hono";

export interface CreateContextOptions {
	context: HonoContext;
}

// biome-ignore lint/suspicious/useAwait: context 工厂按约定为异步，便于后续接入 session/auth 查询
export async function createContext(_options: CreateContextOptions) {
	return {
		auth: null,
		session: null,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
