// @vitest-environment jsdom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { expect, it } from "vitest";
import { Terminal } from "./terminal";
import {
	ENDED_SESSION,
	makeControllableTransport,
	SESSION,
	sessionReadyRaw,
	waitForConnect,
} from "./terminal-test-helpers";

// The session controls (model menu / permission-mode menu / Stop) now live in
// the composer's bottom bar rather than a hardcoded header strip — and the
// model menu lists exactly what the AGENT reports (session_ready.models), not a
// baked-in opus/sonnet/haiku list. These cover that relocation + agent-sourced
// model list, wired through the same `sendInput` control path as before.

/** Opens a base-ui `Select` and picks the option with the given accessible
 * name — plain `fireEvent.click` alone doesn't register the pick in jsdom, so
 * this mirrors the exact event sequence base-ui listens for. */
async function pickSelectOption(
	container: HTMLElement,
	triggerLabel: string,
	optionName: string
): Promise<void> {
	const view = within(container);
	const trigger = view.getByRole("combobox", { name: triggerLabel });
	await act(() => {
		fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
		fireEvent.click(trigger);
	});
	const option = await waitFor(() =>
		within(document.body).getByRole("option", { name: optionName })
	);
	await act(() => {
		fireEvent.pointerDown(option, { button: 0, pointerId: 1 });
		fireEvent.pointerUp(option, { button: 0, pointerId: 1 });
		fireEvent.click(option);
	});
}

/** Renders a live claude terminal and seeds a `session_ready` with the given
 * detail, so the composer's agent-sourced menus have data to render. */
async function renderReady(detail: Record<string, unknown>): Promise<{
	container: HTMLElement;
	fake: ReturnType<typeof makeControllableTransport>;
}> {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});
	await act(() => {
		fake.current()?.onEvent(sessionReadyRaw(1, detail));
	});
	return { container, fake };
}

it("renders the model menu from the agent's reported models and dispatches setModel on pick", async () => {
	const { container, fake } = await renderReady({
		model: "opus",
		models: ["opus", "sonnet"],
	});

	// The menu lists exactly the reported ids — no hardcoded haiku, etc.
	await pickSelectOption(container, "Model", "sonnet");

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: { type: "control", action: "setModel", model: "sonnet" },
		});
	});
});

it("hides the model menu entirely when the agent reports no models", async () => {
	const { container } = await renderReady({ model: "opus" });

	expect(
		within(container).queryByRole("combobox", { name: "Model" })
	).toBeNull();
});

it("dispatches a setPermissionMode control command when a mode is picked", async () => {
	const { container, fake } = await renderReady({ permissionMode: "default" });

	await pickSelectOption(container, "Permission mode", "Plan");

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: { type: "control", action: "setPermissionMode", mode: "plan" },
		});
	});
});

it("swaps Send for a Stop button while a turn is in flight and dispatches interrupt", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;
	fireEvent.change(textarea, { target: { value: "do it" } });
	await act(() => {
		fireEvent.click(view.getByRole("button", { name: "Send" }));
	});

	// The optimistic user echo puts the turn in flight → Send becomes Stop.
	const stop = await waitFor(() => view.getByRole("button", { name: "Stop" }));
	await act(() => {
		fireEvent.click(stop);
	});

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: { type: "control", action: "interrupt" },
		});
	});
});

it("no longer renders the model menu or an Interrupt button in the header", async () => {
	const { container } = await renderReady({
		model: "opus",
		models: ["opus", "sonnet"],
	});
	const view = within(container);

	// No standalone Interrupt control anywhere (it's now the in-flight Stop).
	expect(view.queryByRole("button", { name: "Interrupt" })).toBeNull();
	// The one model menu that exists lives in the composer, not the header.
	expect(view.getAllByRole("combobox", { name: "Model" })).toHaveLength(1);
});

it("disables the composer control menus for an already-ended session", () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={ENDED_SESSION} transport={fake.transport} />
	);

	// The permission-mode menu renders for claude regardless of session_ready
	// (its options come from the capability matrix), so it's the one to check.
	expect(
		(
			within(container).getByRole("combobox", {
				name: "Permission mode",
			}) as HTMLButtonElement
		).disabled
	).toBe(true);
});
