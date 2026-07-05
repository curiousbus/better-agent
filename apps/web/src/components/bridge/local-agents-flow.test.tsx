// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LocalAgentDetail } from "./local-agent-detail";
import { LocalAgentList } from "./local-agent-list";

vi.mock("@/utils/orpc", () => {
	// Inlined rather than a shared top-level const: vi.mock factories are
	// hoisted above the rest of the file, so referencing an outer variable
	// here would throw a TDZ error at import time.
	const now = new Date("2026-07-04T12:00:00Z");
	const rows = [
		{
			id: "session-a",
			userId: "user-1",
			tokenId: "token-1",
			agentKind: "claude-code",
			label: "alpha",
			status: "active",
			createdAt: now,
			lastSeenAt: now,
		},
		{
			id: "session-b",
			userId: "user-1",
			tokenId: "token-1",
			agentKind: "codex",
			label: "beta",
			status: "ended",
			createdAt: now,
			lastSeenAt: now,
		},
	];
	const listSessionsKey = ["bridge", "listSessions"];
	return {
		orpc: {
			bridge: {
				listSessions: {
					queryOptions: () => ({
						queryKey: listSessionsKey,
						queryFn: () => Promise.resolve(rows),
					}),
					key: () => listSessionsKey,
				},
				endSession: {
					mutationOptions: (opts: Record<string, unknown>) => ({
						mutationFn: () => Promise.resolve({ ok: true }),
						...opts,
					}),
				},
			},
		},
	};
});

// A no-op fake so the terminal's connect effect doesn't hit real
// fetch/EventSource — this test only cares that the right session's terminal
// mounts, not the connection lifecycle (covered by terminal.test.tsx).
vi.mock("./bridge-transport", () => ({
	createBridgeTransport: () => ({
		connectStream: () => () => {
			// no cleanup needed for this fake
		},
		observe: () => Promise.resolve([]),
		sendInput: () => Promise.resolve(),
	}),
}));

const rootRoute = createRootRoute({ component: Outlet });
const indexRoute = createRoute({
	component: LocalAgentList,
	getParentRoute: () => rootRoute,
	path: "/local-agents/",
});
const detailRoute = createRoute({
	component: DetailRouteComponent,
	getParentRoute: () => rootRoute,
	path: "/local-agents/$sessionId",
});

function DetailRouteComponent() {
	const { sessionId } = detailRoute.useParams();
	return <LocalAgentDetail sessionId={sessionId} />;
}

function buildTestRouter() {
	const routeTree = rootRoute.addChildren([indexRoute, detailRoute]);
	return createRouter({
		history: createMemoryHistory({ initialEntries: ["/local-agents/"] }),
		routeTree,
	});
}

it("navigates from the list to a session's detail page and renders its terminal", async () => {
	const queryClient = new QueryClient();
	const router = buildTestRouter();
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
	const view = within(container);

	await waitFor(() => {
		expect(view.getByText("alpha")).toBeDefined();
	});
	expect(view.getByText("beta")).toBeDefined();

	fireEvent.click(view.getByText("alpha"));

	await waitFor(() => {
		expect(router.state.location.pathname).toBe("/local-agents/session-a");
	});
	// The detail header and the terminal header both name the session — either
	// is proof the right session's terminal mounted, not session-b's.
	await waitFor(() => {
		expect(view.getAllByText("alpha").length).toBeGreaterThan(0);
	});
	expect(view.queryByText("beta")).toBeNull();
	expect(view.getByText("Connecting…")).toBeDefined();
});
