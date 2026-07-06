// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AddLocalAgentDialog } from "./add-local-agent-dialog";

const store = vi.hoisted(() => ({
	createArgs: [] as Record<string, unknown>[],
	navigatedTo: [] as Record<string, unknown>[],
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => (opts: Record<string, unknown>) => {
		store.navigatedTo.push(opts);
	},
}));

vi.mock("@/utils/orpc", () => {
	const listTokensKey = ["bridge", "listTokens"];
	return {
		orpc: {
			bridge: {
				listTokens: { key: () => listTokensKey },
				createToken: {
					mutationOptions: (opts: Record<string, unknown>) => ({
						mutationFn: (args: Record<string, unknown>) => {
							store.createArgs.push(args);
							return Promise.resolve({
								id: "new-token",
								token: "bt_new",
								last4: "_new",
							});
						},
						...opts,
					}),
				},
			},
		},
	};
});

function renderDialog() {
	const queryClient = new QueryClient();
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<AddLocalAgentDialog />
		</QueryClientProvider>
	);
	return within(container.ownerDocument.body);
}

beforeEach(() => {
	store.createArgs.length = 0;
	store.navigatedTo.length = 0;
});

afterEach(() => {
	cleanup();
});

it("blocks Create until an agent kind is picked, then sends it", async () => {
	const view = renderDialog();
	fireEvent.click(view.getByRole("button", { name: "Add local agent" }));

	const create = await waitFor(() =>
		view.getByRole("button", { name: "Create" })
	);
	expect(create).toHaveProperty("disabled", true);

	// Cancel sits beside Create in the footer.
	expect(view.getByRole("button", { name: "Cancel" })).toBeDefined();

	fireEvent.click(view.getByRole("button", { name: "Codex" }));
	expect(create).toHaveProperty("disabled", false);

	fireEvent.click(create);
	await waitFor(() => {
		expect(store.createArgs).toHaveLength(1);
	});
	expect(store.createArgs[0]?.agentKind).toBe("codex");
});

it("navigates to the new agent's page on success", async () => {
	const view = renderDialog();
	fireEvent.click(view.getByRole("button", { name: "Add local agent" }));

	fireEvent.click(
		await waitFor(() => view.getByRole("button", { name: "Claude Code" }))
	);
	fireEvent.click(view.getByRole("button", { name: "Create" }));

	await waitFor(() => {
		expect(store.navigatedTo).toHaveLength(1);
	});
	expect(store.navigatedTo[0]).toMatchObject({
		to: "/local-agents/$tokenId",
		params: { tokenId: "new-token" },
	});
});
