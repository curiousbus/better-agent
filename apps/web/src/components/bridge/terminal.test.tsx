// @vitest-environment jsdom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { expect, it, vi } from "vitest";
import type { BridgeSessionRow } from "@/utils/api-types";
import type { BridgeTransport, ConnectStreamArgs } from "./bridge-transport";
import { Terminal } from "./terminal";
import { MAX_SSE_FAILURES } from "./terminal-connection";

const SESSION: BridgeSessionRow = {
	id: "session-1",
	userId: "user-1",
	tokenId: "token-1",
	agentKind: "claude-code",
	label: "my-repo",
	status: "active",
	createdAt: new Date("2026-07-04T00:00:00Z"),
	lastSeenAt: new Date("2026-07-04T00:00:00Z"),
};

function statusRaw(id: number, status: string) {
	return { id, data: { kind: "status", status } };
}

function approvalRaw(id: number, requestId: string) {
	return {
		id,
		data: {
			kind: "approval",
			requestId,
			title: "Run `rm -rf tmp/`?",
			detail: "Requested by the agent's shell tool.",
			options: [
				{ id: "allow", label: "Allow" },
				{ id: "deny", label: "Deny" },
			],
		},
	};
}

const EVENT_TEXT_PATTERN = /starting|thinking|done/;
const ALLOW_BUTTON_PATTERN = /Allow/;
const DENY_BUTTON_PATTERN = /Deny/;
const ALLOW_CHOSEN_BUTTON_PATTERN = /Allow.*chosen/;

// A transport whose `connectStream` opens immediately and hands the caller
// its handlers, so a test can drive events (or failures) by hand.
function makeControllableTransport() {
	let latest: ConnectStreamArgs | null = null;
	const connectCalls: ConnectStreamArgs[] = [];
	const sendInput = vi.fn().mockResolvedValue(undefined);
	const observe = vi.fn().mockResolvedValue([]);
	const transport: BridgeTransport = {
		connectStream: (args) => {
			latest = args;
			connectCalls.push(args);
			return () => {
				// unsubscribe: no-op for this fake
			};
		},
		observe,
		sendInput,
	};
	return {
		transport,
		sendInput,
		observe,
		connectCalls,
		current: () => latest,
	};
}

// Not grouped under a `describe` — each of these already fully exercises a
// render + a run of act()s, and the repo's max-lines-per-function limit
// counts a wrapping describe callback's body too.

it("renders a sequence of events in order, never dropping or duplicating on replay overlap", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);

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

it("degrades to polling after MAX_SSE_FAILURES consecutive stream errors", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);

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

it("answers an approval via sendInput, disables its buttons, and shows the chosen option", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await act(() => {
		fake.current()?.onOpen();
	});
	await act(() => {
		fake.current()?.onEvent(approvalRaw(1, "req-1"));
	});

	const view = within(container);
	await act(() => {
		fireEvent.click(view.getByRole("button", { name: ALLOW_BUTTON_PATTERN }));
	});

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: JSON.stringify({
				type: "approval",
				requestId: "req-1",
				optionId: "allow",
			}),
		});
	});
	const allowButton = view.getByRole("button", {
		name: ALLOW_CHOSEN_BUTTON_PATTERN,
	}) as HTMLButtonElement;
	const denyButton = view.getByRole("button", {
		name: "Deny",
	}) as HTMLButtonElement;
	expect(allowButton.disabled).toBe(true);
	expect(denyButton.disabled).toBe(true);
});

it("renders a replayed approval as disabled once its requestId was already answered", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await act(() => {
		fake.current()?.onOpen();
	});
	await act(() => {
		fake.current()?.onEvent(approvalRaw(1, "req-1"));
	});

	const view = within(container);
	await act(() => {
		fireEvent.click(view.getByRole("button", { name: ALLOW_BUTTON_PATTERN }));
	});
	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalled();
	});

	// A reconnect replays the same approval event again.
	await act(() => {
		fake.current()?.onEvent(approvalRaw(1, "req-1"));
	});

	const allowButton = view.getByRole("button", {
		name: ALLOW_CHOSEN_BUTTON_PATTERN,
	}) as HTMLButtonElement;
	const denyButton = view.getByRole("button", {
		name: "Deny",
	}) as HTMLButtonElement;
	expect(allowButton.disabled).toBe(true);
	expect(denyButton.disabled).toBe(true);
});
