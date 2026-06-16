import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { providersRouter } from "./providers";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => "OK"),
	providers: providersRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
