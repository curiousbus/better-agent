import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { accountRouter } from "./account";
import { adminRouter } from "./admin";
import { agentsRouter } from "./agents";
import { authRouter } from "./auth";
import { composioAdminRouter } from "./composio-admin";
import { inviteRouter } from "./invite";
import { providersRouter } from "./providers";
import { sessionsRouter } from "./sessions";
import { userSessionsRouter } from "./user-sessions";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => "OK"),
	auth: authRouter,
	account: accountRouter,
	admin: adminRouter,
	composio: composioAdminRouter,
	invite: inviteRouter,
	providers: providersRouter,
	agents: agentsRouter,
	sessions: sessionsRouter,
	userSessions: userSessionsRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
