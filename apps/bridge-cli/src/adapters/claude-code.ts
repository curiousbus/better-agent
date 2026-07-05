import {
	type CanUseTool,
	type PermissionResult,
	query,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { normalizeClaudeCode } from "../normalize/claude-code";
import type { ApprovalOption, NormalizedEvent } from "../normalize/types";
import { type AsyncQueue, createAsyncQueue } from "./async-queue";
import type { Adapter, AgentHandle } from "./types";

// Drives the LOCAL claude via the official Claude Agent SDK rather than
// hand-spawning `claude -p` and reverse-engineering its stream-json stdin
// protocol (which needs an undocumented `initialize` control handshake — the
// reason a hand-rolled process produced nothing). `query()` takes a streaming
// AsyncIterable of user turns, manages the claude subprocess + handshake, and
// yields SDK messages whose shapes match the CLI stream-json we already
// normalize. Tool permission requests route through `canUseTool` back to the
// web approval UI.

const APPROVAL_OPTIONS: ApprovalOption[] = [
	{ id: "allow", label: "Allow" },
	{ id: "deny", label: "Deny" },
];

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function userTurn(text: string): SDKUserMessage {
	return {
		type: "user",
		message: { role: "user", content: text },
		parent_tool_use_id: null,
	};
}

interface EventSink {
	push(event: NormalizedEvent): void;
}
type ApprovalMap = Map<string, (allow: boolean) => void>;

// Turns each SDK tool-permission request into an approval event and blocks on
// the user's web decision (resolved via the handle's answerApproval).
function makeCanUseTool(events: EventSink, approvals: ApprovalMap): CanUseTool {
	return (toolName, toolInput, options) => {
		const requestId = options.toolUseID;
		events.push({
			kind: "approval",
			requestId,
			title: `Use ${toolName}?`,
			detail: safeJson(toolInput),
			options: APPROVAL_OPTIONS,
		});
		return new Promise<PermissionResult>((resolve) => {
			approvals.set(requestId, (allow) => {
				approvals.delete(requestId);
				resolve(
					allow
						? { behavior: "allow", updatedInput: toolInput }
						: { behavior: "deny", message: "Denied from the bridge." }
				);
			});
		});
	};
}

async function drainSession(
	session: AsyncIterable<unknown>,
	events: AsyncQueue<NormalizedEvent>
): Promise<void> {
	try {
		for await (const message of session) {
			for (const event of normalizeClaudeCode(message)) {
				events.push(event);
			}
		}
	} catch (error) {
		events.push({
			kind: "error",
			message: error instanceof Error ? error.message : String(error),
		});
	}
	events.close();
}

export const claudeCodeAdapter: Adapter = {
	// biome-ignore lint/suspicious/useAwait: the Adapter interface returns a Promise; the SDK query starts lazily.
	async start(dir: string): Promise<AgentHandle> {
		const events = createAsyncQueue<NormalizedEvent>();
		const input = createAsyncQueue<SDKUserMessage>();
		// requestId → resolver that completes the pending canUseTool promise.
		const approvals: ApprovalMap = new Map();

		const session = query({
			prompt: input,
			options: {
				cwd: dir,
				canUseTool: makeCanUseTool(events, approvals),
				// Enable extended thinking. NOTE: the full reasoning text only
				// streams as `thinking_delta` frames under includePartialMessages,
				// which also duplicates the response text — surfacing that cleanly
				// (dedup) is planned work, so we don't turn it on here yet.
				thinking: { type: "adaptive" },
			},
		});
		drainSession(session, events);

		return {
			events,
			answerApproval(requestId: string, optionId: string): void {
				approvals.get(requestId)?.(optionId === "allow");
			},
			send(text: string): void {
				input.push(userTurn(text));
			},
			stop(): void {
				input.close();
				session.interrupt().catch(() => undefined);
				events.close();
			},
		};
	},
};
