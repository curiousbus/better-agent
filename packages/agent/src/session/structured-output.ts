import type { ToolDef } from "../tool/types";

export const STRUCTURED_OUTPUT_TOOL_NAME = "StructuredOutput";

const DESCRIPTION =
	"Submit your final answer as structured JSON. Call this tool exactly once, when you have everything you need; its arguments are your final result.";

/** A no-op server-side tool whose call args carry the structured result. */
export function buildStructuredOutputToolDef(
	outputSchema: Record<string, unknown>
): ToolDef {
	return {
		name: STRUCTURED_OUTPUT_TOOL_NAME,
		description: DESCRIPTION,
		parameters: outputSchema,
		execute: () => Promise.resolve({ output: "" }),
	};
}
