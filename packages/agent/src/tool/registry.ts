import type { ToolSet } from "ai";
import { jsonSchema, tool } from "ai";
import { truncateOutput } from "./truncate";
import type { ToolContext, ToolDef } from "./types";

type CtxBase = Omit<ToolContext, "callId">;

export function buildTools(defs: ToolDef[], ctxBase: CtxBase): ToolSet {
	const tools: ToolSet = {};
	for (const def of defs) {
		if (tools[def.name]) {
			throw new Error(`Duplicate tool name: ${def.name}`);
		}
		tools[def.name] = tool({
			description: def.description,
			inputSchema: jsonSchema(def.parameters),
			execute: async (
				args: unknown,
				options: { toolCallId: string; abortSignal?: AbortSignal }
			) => {
				const result = await def.execute(args, {
					...ctxBase,
					abortSignal: options.abortSignal ?? ctxBase.abortSignal,
					callId: options.toolCallId,
				});
				return truncateOutput(result.output).output;
			},
		});
	}
	return tools;
}
