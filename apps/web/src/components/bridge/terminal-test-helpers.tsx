import { vi } from "vitest";
import type { BridgeSessionRow } from "@/utils/api-types";
import type { BridgeTransport, ConnectStreamArgs } from "./bridge-transport";

/** Shared fixtures/helpers for terminal.test.tsx and terminal-approval.test.tsx
 * — split across two files so neither trips the repo's max-lines-per-file
 * gate, but both drive the same `Terminal` component against the same fake
 * transport shape. Not itself a `*.test.*` file, so vitest's include glob
 * skips it. */

export const SESSION: BridgeSessionRow = {
	id: "session-1",
	userId: "user-1",
	tokenId: "token-1",
	agentKind: "claude-code",
	label: "my-repo",
	status: "active",
	createdAt: new Date("2026-07-04T00:00:00Z"),
	lastSeenAt: new Date("2026-07-04T00:00:00Z"),
};

export const OTHER_SESSION: BridgeSessionRow = { ...SESSION, id: "session-2" };

export function statusRaw(id: number, status: string) {
	return { id, data: { kind: "status", status } };
}

export function approvalRaw(id: number, requestId: string) {
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

export const EVENT_TEXT_PATTERN = /starting|thinking|done/;
export const ALLOW_BUTTON_PATTERN = /Allow/;
export const DENY_BUTTON_PATTERN = /Deny/;
export const ALLOW_CHOSEN_BUTTON_PATTERN = /Allow.*chosen/;

// A transport whose `connectStream` opens immediately and hands the caller
// its handlers, so a test can drive events (or failures) by hand.
export function makeControllableTransport() {
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
