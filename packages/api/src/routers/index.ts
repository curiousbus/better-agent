import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { agentsRouter } from "./agents";
import { providersRouter } from "./providers";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => "OK"),
	providers: providersRouter,
	agents: agentsRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
