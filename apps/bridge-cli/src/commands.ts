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

export type ParsedCommand = ApprovalCommand | TextCommand;

function isApprovalCommand(data: unknown): data is ApprovalCommand {
	return (
		isRecord(data) &&
		data.type === "approval" &&
		typeof data.requestId === "string" &&
		typeof data.optionId === "string"
	);
}

/**
 * Parses one relayed command's `data` (`unknown` on the wire) into either a
 * text send or an approval answer. Accepts a bare string or `{ text }` (a
 * plain-text command) and `{ type: "approval", requestId, optionId }` (the
 * web UI's reply to an `ApprovalEvent`); anything else is `null` and left
 * undispatched.
 */
export function parseCommandText(data: unknown): ParsedCommand | null {
	if (typeof data === "string") {
		return { text: data, type: "text" };
	}
	if (isApprovalCommand(data)) {
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

/** The subset of `AgentHandle` `pollLoop` needs to dispatch a command —
 * either a text send or an answer to a pending approval. */
export interface CommandSink {
	answerApproval(requestId: string, optionId: string): void;
	send(text: string): void;
}

/** Parses and dispatches each command to `sink` — a text command calls
 * `sink.send`, an approval command calls `sink.answerApproval` — advancing
 * `afterIdRef` past every command seen, whether or not it was dispatched.
 * Returns whether any commands were seen at all (used by `pollLoop` to decide
 * whether to speed back up or keep backing off). */
export function dispatchCommands(
	commands: RelayEvent[],
	sink: CommandSink,
	afterIdRef: AfterIdRef
): boolean {
	for (const command of commands) {
		const parsed = parseCommandText(command.data);
		if (parsed?.type === "text") {
			sink.send(parsed.text);
		} else if (parsed?.type === "approval") {
			sink.answerApproval(parsed.requestId, parsed.optionId);
		}
		afterIdRef.current = command.id;
	}
	return commands.length > 0;
}
