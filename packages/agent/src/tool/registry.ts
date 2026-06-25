import type { ToolSet } from "ai";
import { jsonSchema, tool } from "ai";
import type { DoomLoopGuard } from "../session/doom-loop";
import { DOOM_LOOP_MESSAGE } from "../session/doom-loop";
import { truncateOutput } from "./truncate";
import type { ToolContext, ToolDef } from "./types";

type CtxBase = Omit<ToolContext, "callId">;

export function buildTools(
	defs: ToolDef[],
	ctxBase: CtxBase,
	opts?: { cacheLastToolDef?: boolean; guard?: DoomLoopGuard }
): ToolSet {
	const tools: ToolSet = {};
	for (const [i, def] of defs.entries()) {
		if (tools[def.name]) {
			throw new Error(`Duplicate tool name: ${def.name}`);
		}
		const isLast = i === defs.length - 1;
		const cacheLast = opts?.cacheLastToolDef === true && isLast;
		tools[def.name] = tool({
			description: def.description,
			inputSchema: jsonSchema(def.parameters),
			...(cacheLast
				? {
						providerOptions: {
							anthropic: { cacheControl: { type: "ephemeral" } },
						},
					}
				: {}),
			execute: async (
				args: unknown,
				options: { toolCallId: string; abortSignal?: AbortSignal }
			) => {
				if (opts?.guard?.check(def.name, args)) {
					return DOOM_LOOP_MESSAGE;
				}
				const result = await def.execute(args, {
					...ctxBase,
					abortSignal: options.abortSignal ?? ctxBase.abortSignal,
					callId: options.toolCallId,
				});
				const output = truncateOutput(result.output).output;
				if (result.isError) {
					throw new Error(output);
				}
				return output;
			},
		});
	}
	return tools;
}
