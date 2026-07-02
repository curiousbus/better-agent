import { buildSprintToolDefs } from "@better-agent/agent/tool/sprint-tools";
import { buildTaskToolDefs } from "@better-agent/agent/tool/task-tools";
import type { ToolDef } from "@better-agent/agent/tool/types";
import type { Context } from "../context";

// Destructive board tools are kept OUT of the natural-language model turn — a
// vague command shouldn't be able to delete a task or end a sprint. They remain
// available on the direct (button-driven) toolCalls path.
const NL_UNSAFE_TOOLS = new Set([
	"deleteTask",
	"deleteSprint",
	"completeSprint",
]);

/** Every board tool, for the direct (no-model) toolCalls path. */
export function boardDirectDefs(context: Context, userId: string): ToolDef[] {
	return [
		...buildTaskToolDefs(context.services.stores.task, userId),
		...buildSprintToolDefs(context.services.stores.sprint, userId),
	];
}

/** The NL-safe subset bound to model turns that opt into the board surface. */
export function boardModelDefs(context: Context, userId: string): ToolDef[] {
	return boardDirectDefs(context, userId).filter(
		(def) => !NL_UNSAFE_TOOLS.has(def.name)
	);
}
