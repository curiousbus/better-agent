import {
	appendText,
	type ChatBlock,
	type ToolInvocation,
} from "@better-agent/ui/components/chat/chat-blocks";
import { isTaskToolInput } from "@/genui/tool-renderers";
import type {
	ApprovalEvent,
	ErrorEvent,
	FileEvent,
	MessageEvent,
	NormalizedEvent,
	StatusEvent,
	StreamEvent,
	ToolEvent,
} from "./bridge-events";
import {
	SESSION_LIST_STATUS,
	SESSION_READY_STATUS,
	TURN_USAGE_STATUS,
} from "./bridge-session-status";
import { stripTaskWrapper, type TaskInvocation } from "./task-card";
import { flattenToolResult } from "./tool-result-text";

/** These curated status events carry session METADATA (capabilities,
 * cost/tokens, the past-conversations list) surfaced by dedicated header/chip
 * UI — see session-status-header.tsx, turn-usage-panel.tsx, and
 * past-conversations.tsx — never as an inline chat row. They still act as a
 * turn boundary (closing any open assistant accumulation) but are dropped
 * from the rendered turn list. */
const HIDDEN_STATUS_KINDS = new Set<string>([
	SESSION_READY_STATUS,
	TURN_USAGE_STATUS,
	SESSION_LIST_STATUS,
]);

/**
 * One coherent turn folded out of the granular bridge event stream, ready to
 * render with the same components the normal chat uses. `message`/`output`/
 * `tool` events collapse into `user`/`assistant` bubbles; the remaining kinds
 * pass through as their own inline rows (a subtle status line, an error line,
 * a file line, or the bridge-specific approval card).
 */
export interface AssistantTurn {
	blocks: ChatBlock[];
	id: number;
	kind: "assistant";
	/** Set only on the trailing still-open turn, so the streaming markdown
	 * caret shows while output is arriving and stops at the next boundary. */
	streaming: boolean;
}

export interface UserTurn {
	id: number;
	kind: "user";
	text: string;
}

export interface StatusTurn {
	event: StatusEvent;
	id: number;
	kind: "status";
}

export interface ErrorTurn {
	event: ErrorEvent;
	id: number;
	kind: "error";
}

export interface FileTurn {
	event: FileEvent;
	id: number;
	kind: "file";
}

export interface ApprovalTurn {
	event: ApprovalEvent;
	id: number;
	kind: "approval";
}

/** A subagent "Task" tool call, folded out of the ordinary tool-block flow
 * into its own turn (like status/error/file lines) so it renders as a task
 * card instead of a generic tool row — see `isTaskToolInput`. */
export interface TaskTurn {
	id: number;
	kind: "task";
	task: TaskInvocation;
}

export type BridgeTurn =
	| AssistantTurn
	| UserTurn
	| StatusTurn
	| ErrorTurn
	| FileTurn
	| ApprovalTurn
	| TaskTurn;

interface FoldState {
	current: AssistantTurn | null;
	tasksByCallId: Map<string, TaskInvocation>;
	toolsByCallId: Map<string, ToolInvocation>;
	turns: BridgeTurn[];
}

function toolStatusOf(status: ToolEvent["status"]): {
	isError: boolean;
	status: ToolInvocation["status"];
} {
	if (status === "completed") {
		return { status: "complete", isError: false };
	}
	if (status === "failed") {
		return { status: "error", isError: true };
	}
	return { status: "running", isError: false };
}

function applyToolResult(tool: ToolInvocation, event: ToolEvent): void {
	const { status, isError } = toolStatusOf(event.status);
	tool.status = status;
	tool.isError = isError;
	if (event.output !== undefined) {
		tool.result = flattenToolResult(event.output);
	}
}

/** A task's title is its `description` input when present (opencode names
 * the call after it already, but Claude's fixed-name "Task" tool doesn't),
 * falling back to the raw tool name otherwise. */
function taskTitle(event: ToolEvent): string {
	const input = event.input as { description?: unknown } | null | undefined;
	if (input && typeof input.description === "string" && input.description) {
		return input.description;
	}
	return event.name;
}

function createTaskInvocation(event: ToolEvent): TaskInvocation {
	return {
		callId: event.id,
		resultText: "",
		status: "running",
		title: taskTitle(event),
	};
}

function updateTaskInvocation(task: TaskInvocation, event: ToolEvent): void {
	const { status } = toolStatusOf(event.status);
	task.status = status;
	if (event.output !== undefined) {
		task.resultText = stripTaskWrapper(flattenToolResult(event.output));
	}
}

/** A task call never joins the assistant's block flow — it closes any open
 * assistant accumulation and renders as its own turn, mirroring how a file
 * or status event is folded, so its card can show every status (a plain
 * `ToolGroup` rich-render only ever shows once a call is complete). */
function foldTaskTool(state: FoldState, id: number, event: ToolEvent): void {
	state.current = null;
	const existing = state.tasksByCallId.get(event.id);
	const task = existing ?? createTaskInvocation(event);
	updateTaskInvocation(task, event);
	if (!existing) {
		state.tasksByCallId.set(event.id, task);
		state.turns.push({ kind: "task", id, task });
	}
}

/** Reuse the open assistant turn, or start (and record) a fresh one. */
function openAssistant(state: FoldState, id: number): AssistantTurn {
	if (state.current) {
		return state.current;
	}
	const turn: AssistantTurn = {
		kind: "assistant",
		id,
		blocks: [],
		streaming: false,
	};
	state.turns.push(turn);
	state.current = turn;
	return turn;
}

function foldMessage(state: FoldState, id: number, event: MessageEvent): void {
	// A message is a turn boundary: it closes any open output accumulation.
	state.current = null;
	if (event.role === "user") {
		state.turns.push({ kind: "user", id, text: event.text });
		return;
	}
	const turn: AssistantTurn = {
		kind: "assistant",
		id,
		blocks: [],
		streaming: false,
	};
	if (event.thinking) {
		turn.blocks.push({ kind: "reasoning", text: event.text });
	} else {
		appendText(turn.blocks, "text", event.text);
	}
	state.turns.push(turn);
}

function foldTool(state: FoldState, id: number, event: ToolEvent): void {
	// A completed/failed follow-up for an already-started task never carries
	// `input` again, so a call already known to be a task is routed there
	// unconditionally — only a brand-new call needs the input-shape check.
	if (state.tasksByCallId.has(event.id)) {
		foldTaskTool(state, id, event);
		return;
	}
	// A later update (completed/failed) mutates the block created at `started`
	// in place — even if a boundary has since closed that assistant turn — so
	// it never spawns a spurious empty bubble.
	const existing = state.toolsByCallId.get(event.id);
	if (existing) {
		applyToolResult(existing, event);
		return;
	}
	if (isTaskToolInput(event.input)) {
		foldTaskTool(state, id, event);
		return;
	}
	const turn = openAssistant(state, id);
	const tool: ToolInvocation = {
		callId: event.id,
		toolName: event.name,
		args: event.input,
		isError: false,
		status: "running",
	};
	applyToolResult(tool, event);
	turn.blocks.push({ kind: "tool", tool });
	state.toolsByCallId.set(event.id, tool);
}

function foldEvent(state: FoldState, id: number, event: NormalizedEvent): void {
	switch (event.kind) {
		case "message":
			foldMessage(state, id, event);
			return;
		case "output":
			appendText(
				openAssistant(state, id).blocks,
				event.reasoning ? "reasoning" : "text",
				event.text
			);
			return;
		case "tool":
			foldTool(state, id, event);
			return;
		case "status":
			state.current = null;
			if (!HIDDEN_STATUS_KINDS.has(event.status)) {
				state.turns.push({ kind: "status", id, event });
			}
			return;
		case "error":
			state.current = null;
			state.turns.push({ kind: "error", id, event });
			return;
		case "file":
			state.current = null;
			state.turns.push({ kind: "file", id, event });
			return;
		default:
			state.current = null;
			state.turns.push({ kind: "approval", id, event });
	}
}

/**
 * Folds the ordered, already-deduped bridge feed into renderable turns. Pure
 * and deterministic: only the trailing still-open assistant turn is marked
 * `streaming`, so a completed turn never keeps a caret.
 */
export function foldEventsToTurns(events: StreamEvent[]): BridgeTurn[] {
	const state: FoldState = {
		current: null,
		tasksByCallId: new Map(),
		toolsByCallId: new Map(),
		turns: [],
	};
	for (const { id, event } of events) {
		foldEvent(state, id, event);
	}
	if (state.current) {
		state.current.streaming = true;
	}
	return state.turns;
}
