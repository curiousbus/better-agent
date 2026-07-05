// @vitest-environment jsdom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { expect, it } from "vitest";
import { Terminal } from "./terminal";
import {
	ENDED_SESSION,
	makeControllableTransport,
	SESSION,
	waitForConnect,
} from "./terminal-test-helpers";

// Covers Phase 5's session controls (Interrupt / model / permission mode),
// wired through the same `sendInput` transport path as a chat send or an
// approval decision (see use-bridge-terminal.ts's `sendControlCommand`).
// Split out of terminal.test.tsx to stay under the repo's max-lines-per-file
// gate.

/** Opens a base-ui `Select` and picks the option with the given accessible
 * name — plain `fireEvent.click` alone doesn't register the pick in jsdom
 * (no PointerEvent-driven open, no pointerdown+pointerup on the option), so
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

it("dispatches an interrupt control command via sendInput when Interrupt is clicked", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	const view = within(container);
	await act(() => {
		fireEvent.click(view.getByRole("button", { name: "Interrupt" }));
	});

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: { type: "control", action: "interrupt" },
		});
	});
});

it("dispatches a setModel control command via sendInput when a model is picked", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	await pickSelectOption(container, "Model", "Opus");

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: { type: "control", action: "setModel", model: "opus" },
		});
	});
});

it("dispatches a setPermissionMode control command via sendInput when a mode is picked", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	await pickSelectOption(container, "Permission mode", "Plan");

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: { type: "control", action: "setPermissionMode", mode: "plan" },
		});
	});
});

it("disables the session controls for an already-ended session", () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={ENDED_SESSION} transport={fake.transport} />
	);

	const view = within(container);
	expect(
		(view.getByRole("button", { name: "Interrupt" }) as HTMLButtonElement)
			.disabled
	).toBe(true);
	expect(
		(view.getByRole("combobox", { name: "Model" }) as HTMLButtonElement)
			.disabled
	).toBe(true);
	expect(
		(
			view.getByRole("combobox", {
				name: "Permission mode",
			}) as HTMLButtonElement
		).disabled
	).toBe(true);
});
