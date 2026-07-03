import type { ToolDef } from "./types";

// Built-in, server-executed tools that need no external credentials. Agents opt
// in by id (AgentConfig.builtinTools).

export interface BuiltinToolMeta {
	/** Display group in pickers (e.g. "Utilities"). */
	category: string;
	description: string;
	id: string;
	label: string;
}

const getCurrentTime: ToolDef = {
	name: "get_current_time",
	description: "Get the current date and time as an ISO 8601 string in UTC.",
	parameters: { type: "object", properties: {}, additionalProperties: false },
	execute: () => Promise.resolve({ output: new Date().toISOString() }),
};

const REGISTRY: Record<string, ToolDef> = {
	get_current_time: getCurrentTime,
};

// Metadata for the admin UI's built-in tools picker.
export const BUILTIN_TOOLS: BuiltinToolMeta[] = [
	{
		id: "get_current_time",
		label: "Current time",
		category: "Utilities",
		description: "Returns the current UTC date and time.",
	},
];

export function buildBuiltinToolDefs(ids: string[]): ToolDef[] {
	return ids
		.map((id) => REGISTRY[id])
		.filter((def): def is ToolDef => def !== undefined);
}
