import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { accountRouter } from "./account";
import { adminRouter } from "./admin";
import { agentsRouter } from "./agents";
import { authRouter } from "./auth";
import { composioRouter } from "./composio";
import { providersRouter } from "./providers";
import { sessionsRouter } from "./sessions";
import { settingsRouter } from "./settings";
import { userSessionsRouter } from "./user-sessions";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => "OK"),
	auth: authRouter,
	account: accountRouter,
	admin: adminRouter,
	composio: composioRouter,
	providers: providersRouter,
	settings: settingsRouter,
	agents: agentsRouter,
	sessions: sessionsRouter,
	userSessions: userSessionsRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
