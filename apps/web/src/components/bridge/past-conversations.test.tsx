// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { Terminal } from "./terminal";
import {
	makeControllableTransport,
	SESSION,
	waitForConnect,
} from "./terminal-test-helpers";

// Phase 3: the "Past conversations" button requests the CLI's local claude
// session list (`{ control: listSessions }`) and renders whatever `session_list`
// status event comes back — see use-bridge-terminal.ts and
// past-conversations.tsx. Read-only: it never relaunches the CLI itself, just
// gives a copy-able `--resume` command. Popover content renders through a
// portal onto `document.body`, outside the `render()` container, so these
// assertions query via `screen` (the whole document) rather than
// `within(container)` — which means, unlike this file's sibling tests, each
// render here must be torn down afterward or the next test's `screen` query
// sees both.

afterEach(() => {
	cleanup();
});

const RESUME_COMMAND_PATTERN =
	/--dir \/Users\/john\/project --resume claude-session-abc/;

it("sends a listSessions control command via sendInput when the button is opened", async () => {
	const fake = makeControllableTransport();
	render(<Terminal session={SESSION} transport={fake.transport} />);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	await act(() => {
		fireEvent.click(screen.getByRole("button", { name: "Past conversations" }));
	});

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: { type: "control", action: "listSessions" },
		});
	});
});

it("renders the session_list detail's items with a resume hint once it arrives", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: {
				kind: "status",
				status: "session_list",
				detail: {
					sessions: [
						{
							id: "claude-session-abc",
							title: "Fix the login bug",
							lastModified: 1_700_000_000_000,
							gitBranch: "main",
							cwd: "/Users/john/project",
						},
					],
				},
			},
		},
	]);
	render(<Terminal session={SESSION} transport={fake.transport} />);
	await act(() => {
		fireEvent.click(screen.getByRole("button", { name: "Past conversations" }));
	});

	await waitFor(() => {
		expect(screen.getByText("Fix the login bug")).toBeDefined();
	});
	expect(screen.getByText("main")).toBeDefined();
	expect(
		screen.getByText(RESUME_COMMAND_PATTERN, { selector: "code" })
	).toBeDefined();
});

it("shows an empty state when the session_list detail has no sessions", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: {
				kind: "status",
				status: "session_list",
				detail: { sessions: [] },
			},
		},
	]);
	render(<Terminal session={SESSION} transport={fake.transport} />);
	await act(() => {
		fireEvent.click(screen.getByRole("button", { name: "Past conversations" }));
	});

	await waitFor(() => {
		expect(
			screen.getByText("No past conversations found for this directory.")
		).toBeDefined();
	});
});
