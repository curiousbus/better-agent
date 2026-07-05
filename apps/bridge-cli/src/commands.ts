// Parses one relayed command's `data` (`unknown` on the wire) into either a
// plain-text send or an answer to a previously-emitted `ApprovalEvent`, and
// dispatches it to a `CommandSink` — split out of relay-client.ts to keep
// that file under the project's file-size limit.

import { isRecord } from "./normalize/types";

/** One relayed command/event; mirrors `RelayEvent` from `@better-agent/agent/ports`. */
export interface RelayEvent {
	data: unknown;
	id: number;
}

/** A plain-text command to feed to the agent via `send`. */
export interface TextCommand {
	text: string;
	type: "text";
}

/** The user's answer to a previously-emitted `ApprovalEvent`, to feed to the
 * agent via `answerApproval`. */
export interface ApprovalCommand {
	optionId: string;
	requestId: string;
	type: "approval";
}

/** A server-initiated request to end this session right now — the web UI's
 * "End session" action (see `packages/api/src/routers/bridge.ts`'s
 * `endSession`), relayed as a control command instead of a plain text one so
 * the CLI can tell "stop the agent" apart from "send it this text". */
export interface ControlStopCommand {
	action: "stop";
	type: "control";
}

export type ParsedCommand = ApprovalCommand | ControlStopCommand | TextCommand;

function isApprovalCommand(data: unknown): data is ApprovalCommand {
	return (
		isRecord(data) &&
		data.type === "approval" &&
		typeof data.requestId === "string" &&
		typeof data.optionId === "string"
	);
}

function isControlStopCommand(data: unknown): data is ControlStopCommand {
	return isRecord(data) && data.type === "control" && data.action === "stop";
}

/**
 * Parses one relayed command's `data` (`unknown` on the wire) into a text
 * send, an approval answer, or a control command. Accepts a bare string or
 * `{ text }` (a plain-text command), `{ type: "approval", requestId,
 * optionId }` (the web UI's reply to an `ApprovalEvent`), and `{ type:
 * "control", action: "stop" }` (the web UI's "End session" action); anything
 * else is `null` and left undispatched.
 */
export function parseCommandText(data: unknown): ParsedCommand | null {
	if (typeof data === "string") {
		return { text: data, type: "text" };
	}
	if (isApprovalCommand(data)) {
		return data;
	}
	if (isControlStopCommand(data)) {
		return data;
	}
	if (isRecord(data) && typeof data.text === "string") {
		return { text: data.text, type: "text" };
	}
	return null;
}

/** Mutable so pollLoop can resume from the last seen id after a reconnect. */
export interface AfterIdRef {
	current: number;
}

/** The subset of `AgentHandle` `pollLoop` needs to dispatch a command — a
 * text send, an answer to a pending approval, or (optionally — most fakes in
 * tests only exercise send/answerApproval) a request to stop the agent. */
export interface CommandSink {
	answerApproval(requestId: string, optionId: string): void;
	send(text: string): void;
	/** Stops the agent process. Called for a `control: stop` command; see
	 * `AgentHandle.stop` in `apps/bridge-cli/src/adapters/types.ts`, which the
	 * real sink (the running session's `handle`) always implements. */
	stop?(): void;
}

/** What `dispatchCommands` did with a batch of relayed commands. */
export interface DispatchResult {
	/** A `control: stop` command was seen — the caller (`pollLoop`) should
	 * stop polling and wind the session down instead of scheduling another
	 * poll. */
	stopRequested: boolean;
	/** Whether any commands were seen at all (used by `pollLoop` to decide
	 * whether to speed back up or keep backing off). */
	wasActive: boolean;
}

/** Parses and dispatches each command to `sink` — a text command calls
 * `sink.send`, an approval command calls `sink.answerApproval`, a control
 * command calls `sink.stop` — advancing `afterIdRef` past every command seen,
 * whether or not it was dispatched. */
export function dispatchCommands(
	commands: RelayEvent[],
	sink: CommandSink,
	afterIdRef: AfterIdRef
): DispatchResult {
	let stopRequested = false;
	for (const command of commands) {
		const parsed = parseCommandText(command.data);
		if (parsed?.type === "text") {
			sink.send(parsed.text);
		} else if (parsed?.type === "approval") {
			sink.answerApproval(parsed.requestId, parsed.optionId);
		} else if (parsed?.type === "control") {
			sink.stop?.();
			stopRequested = true;
		}
		afterIdRef.current = command.id;
	}
	return { stopRequested, wasActive: commands.length > 0 };
}
