import { authorizedUserProcedure } from "../index";

export const activityRouter = {
	// The signed-in user's recent activity (most recent first) for their dashboard.
	list: authorizedUserProcedure.handler(({ context }) =>
		context.services.stores.activity.listByUser(context.authedUser.id)
	),
};
