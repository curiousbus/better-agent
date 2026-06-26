import { adminProcedure } from "../index";

export const composioRouter = {
	// The composio toolkit catalog, admin-only. Graceful: not configured when no
	// COMPOSIO_API_KEY; empty when the upstream call fails (never breaks the page).
	listToolkits: adminProcedure.handler(async ({ context }) => {
		const svc = context.services.composio;
		if (!svc) {
			return { configured: false, toolkits: [] };
		}
		try {
			return { configured: true, toolkits: await svc.listToolkits() };
		} catch {
			return { configured: true, toolkits: [] };
		}
	}),
};
