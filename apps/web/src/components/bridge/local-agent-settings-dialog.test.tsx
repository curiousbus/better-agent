// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { BridgeTokenRow } from "@/utils/api-types";
import { LocalAgentSettingsDialog } from "./local-agent-settings-dialog";

afterEach(cleanup);

const NOT_CONFIGURABLE_RE = /no page-configurable startup settings yet/i;

function makeToken(overrides: Partial<BridgeTokenRow> = {}): BridgeTokenRow {
	return {
		id: "token-1",
		userId: "user-1",
		name: "alpha",
		agentKind: "claude-code",
		token: "bt_alpha",
		last4: "1234",
		config: null,
		createdAt: new Date("2026-07-04T12:00:00Z"),
		revokedAt: null,
		...overrides,
	};
}

function renderDialog(token: BridgeTokenRow) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { baseElement } = render(
		<QueryClientProvider client={queryClient}>
			<LocalAgentSettingsDialog
				onOpenChange={() => undefined}
				open
				token={token}
			/>
		</QueryClientProvider>
	);
	// The dialog renders in a portal, so query from the document body.
	return within(baseElement);
}

it("shows the startup-config fields for claude-code (its adapter applies them)", () => {
	const view = renderDialog(makeToken());
	fireEvent.click(view.getByRole("tab", { name: "Config" }));
	expect(view.getByLabelText("Append system prompt")).toBeDefined();
	expect(view.getByLabelText("Max turns")).toBeDefined();
});

it("shows a 'not configurable yet' note for an agent whose adapter ignores config", () => {
	const view = renderDialog(makeToken({ agentKind: "opencode" }));
	fireEvent.click(view.getByRole("tab", { name: "Config" }));
	// No fields that would persist but never apply…
	expect(view.queryByLabelText("Append system prompt")).toBeNull();
	// …just an honest note.
	expect(view.getByText(NOT_CONFIGURABLE_RE)).toBeDefined();
});
