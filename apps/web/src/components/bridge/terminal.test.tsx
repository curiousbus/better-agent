// @vitest-environment jsdom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { expect, it } from "vitest";
import { Terminal } from "./terminal";
import { MAX_SSE_FAILURES } from "./terminal-connection";
import {
	ALLOW_BUTTON_PATTERN,
	approvalRaw,
	DENY_BUTTON_PATTERN,
	ENDED_SESSION,
	EVENT_TEXT_PATTERN,
	makeControllableTransport,
	SESSION,
	statusRaw,
	waitForConnect,
} from "./terminal-test-helpers";

// Not grouped under a `describe` — each of these already fully exercises a
// render + a run of act()s, and the repo's max-lines-per-function limit
// counts a wrapping describe callback's body too.

it("renders a sequence of events in order, never dropping or duplicating on replay overlap", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);

	await act(() => {
		fake.current()?.onOpen();
	});
	await act(() => {
		fake.current()?.onEvent(statusRaw(1, "starting"));
		fake.current()?.onEvent(statusRaw(2, "thinking"));
		fake.current()?.onEvent(statusRaw(3, "done"));
	});
	// A reconnect replays the whole window, including ids already delivered
	// live — none of it should re-render or reorder anything.
	await act(() => {
		fake.current()?.onEvent(statusRaw(2, "thinking"));
		fake.current()?.onEvent(statusRaw(3, "done"));
	});

	const lines = within(container).getAllByText(EVENT_TEXT_PATTERN);
	expect(lines.map((el) => el.textContent)).toEqual([
		"starting",
		"thinking",
		"done",
	]);
});

it("posts input via the transport and clears the box", async () => {
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
	fireEvent.change(textarea, { target: { value: "hello agent" } });
	fireEvent.click(view.getByRole("button", { name: "Send" }));

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: "hello agent",
		});
	});
	expect(textarea.value).toBe("");
});

it("echoes the user's own line into the feed immediately, before the CLI replies", async () => {
	// The transport never resolves, so nothing comes back over the wire — the
	// line must appear purely from the optimistic local echo.
	const fake = makeControllableTransport();
	fake.sendInput.mockReturnValue(new Promise(() => undefined));
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;
	fireEvent.change(textarea, { target: { value: "ship it" } });
	fireEvent.click(view.getByRole("button", { name: "Send" }));

	await waitFor(() => {
		expect(view.getByText("ship it")).toBeDefined();
	});
});

it("can send input before the output stream has connected", async () => {
	// Regression: input (sendInput RPC) and output (SSE observe) are independent
	// channels. A failing/slow observe stream must NOT disable the composer —
	// gating send on the stream having opened once silenced input entirely when
	// the SSE couldn't connect. Note: no onOpen() is called here.
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;
	expect(textarea.disabled).toBe(false);
	fireEvent.change(textarea, { target: { value: "hello before connect" } });
	fireEvent.click(view.getByRole("button", { name: "Send" }));
	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: "hello before connect",
		});
	});
});

it("degrades to polling after MAX_SSE_FAILURES consecutive stream errors", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);

	for (let i = 0; i < MAX_SSE_FAILURES; i++) {
		await act(() => {
			fake.current()?.onError();
		});
	}

	await waitFor(() => {
		expect(within(container).getByText("Degraded (polling)")).toBeDefined();
	});
	expect(fake.connectCalls.length).toBe(MAX_SSE_FAILURES);
	await waitFor(() => {
		expect(fake.observe).toHaveBeenCalled();
	});
});

it("renders an approval event as a card with one button per option", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	await act(() => {
		fake.current()?.onEvent(approvalRaw(1, "req-1"));
	});

	const view = within(container);
	expect(view.getByText("Run `rm -rf tmp/`?")).toBeDefined();
	expect(view.getByText("Requested by the agent's shell tool.")).toBeDefined();
	expect(
		view.getByRole("button", { name: ALLOW_BUTTON_PATTERN })
	).toBeDefined();
	expect(view.getByRole("button", { name: DENY_BUTTON_PATTERN })).toBeDefined();
});

it("shows an Ended status and never connects or polls for an already-ended session", () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={ENDED_SESSION} transport={fake.transport} />
	);

	const view = within(container);
	expect(view.getByText("Ended")).toBeDefined();
	expect(fake.connectCalls.length).toBe(0);
	expect(fake.observe).not.toHaveBeenCalled();
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;
	expect(textarea.disabled).toBe(true);
});
