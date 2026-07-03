import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { ErrorPage } from "./components/error-page";
import { routeTree } from "./routeTree.gen";
import { createQueryClient, orpc } from "./utils/orpc";

// The router's error boundary is the one legitimate place to log an
// uncaught render/loader error — the UI itself shows no raw error text.
function logRouterError(error: unknown) {
	// biome-ignore lint/suspicious/noConsole: error boundary is the legitimate exception to the console ban
	console.error(error);
}

function RouterErrorComponent({ error }: { error: unknown }) {
	logRouterError(error);
	return <ErrorPage />;
}

export const getRouter = () => {
	const queryClient = createQueryClient();

	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreloadStaleTime: 0,
		context: { orpc, queryClient },
		defaultNotFoundComponent: () => <div>Not Found</div>,
		defaultErrorComponent: RouterErrorComponent,
	});

	setupRouterSsrQueryIntegration({
		router,
		queryClient,
	});

	return router;
};

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
