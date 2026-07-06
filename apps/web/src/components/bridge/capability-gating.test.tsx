// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { Terminal } from "./terminal";
import {
	CODEX_SESSION,
	makeControllableTransport,
	PI_SESSION,
	SESSION,
	turnUsageRaw,
	waitForConnect,
} from "./terminal-test-helpers";

// Phase 0.5: the detail page gates every optional surface on the session's
// agentKind-derived capability matrix (see agent-capabilities.ts) instead of
// always assuming claude. `terminal.test.tsx`/`terminal-controls.test.tsx`
// already cover claude's full surface; this file covers pi (a reduced
// surface) and codex (the conservative fallback) not regressing back to
// "show everything".

const COST_TEXT_PATTERN = /\$0\.05/;

afterEach(() => {
	cleanup();
});

/** Opens a base-ui `Select` — mirrors the sequence in
 * terminal-controls.test.tsx, needed here only to inspect which options a
 * gated dropdown actually offers. */
async function openSelect(
	container: HTMLElement,
	triggerLabel: string
): Promise<void> {
	const trigger = within(container).getByRole("combobox", {
		name: triggerLabel,
	});
	await act(() => {
		fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
		fireEvent.click(trigger);
	});
	await waitFor(() => {
		expect(within(document.body).getByRole("listbox")).toBeDefined();
	});
}

it("hides Past conversations for a pi session (no session-list capability)", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={PI_SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	expect(
		within(container).queryByRole("button", { name: "Past conversations" })
	).toBeNull();
});

it("hides the model menu for a pi session that reports no models", async () => {
	// pi's wired RPC surface doesn't expose a model list, so the composer's
	// model menu stays hidden — the picker lists exactly what the agent reports.
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={PI_SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	expect(
		within(container).queryByRole("combobox", { name: "Model" })
	).toBeNull();
});

it("restricts the permission-mode dropdown to pi's default/plan set", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={PI_SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	await openSelect(container, "Permission mode");

	const body = within(document.body);
	expect(body.getByRole("option", { name: "Default" })).toBeDefined();
	expect(body.getByRole("option", { name: "Plan" })).toBeDefined();
	expect(body.queryByRole("option", { name: "Accept edits" })).toBeNull();
	expect(body.queryByRole("option", { name: "Bypass permissions" })).toBeNull();
});

it("skips the turn-usage chip for a pi session (usageMode is poll, not stream)", async () => {
	const fake = makeControllableTransport();
	render(<Terminal session={PI_SESSION} transport={fake.transport} />);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});
	await act(() => {
		fake.current()?.onEvent(turnUsageRaw(1, { costUsd: 0.05, numTurns: 1 }));
	});

	expect(screen.queryByText(COST_TEXT_PATTERN)).toBeNull();
});

it("keeps the claude session's turn-usage chip rendering (usageMode is stream)", async () => {
	const fake = makeControllableTransport();
	render(<Terminal session={SESSION} transport={fake.transport} />);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});
	await act(() => {
		fake.current()?.onEvent(turnUsageRaw(1, { costUsd: 0.05, numTurns: 1 }));
	});

	await waitFor(() => {
		expect(screen.getByText(COST_TEXT_PATTERN)).toBeDefined();
	});
});

it("hides Past conversations, the model picker, and the permission-mode dropdown for a conservative codex session", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={CODEX_SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	const view = within(container);
	expect(view.queryByRole("button", { name: "Past conversations" })).toBeNull();
	expect(view.queryByRole("combobox", { name: "Model" })).toBeNull();
	expect(view.queryByRole("combobox", { name: "Permission mode" })).toBeNull();
	// No standalone Interrupt control anymore — Stop only appears in-flight.
	expect(view.queryByRole("button", { name: "Interrupt" })).toBeNull();
});
