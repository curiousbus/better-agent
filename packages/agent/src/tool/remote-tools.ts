import type { PendingToolCallStore } from "./pending-store";
import type { JsonSchema, ToolDef } from "./types";

export interface RemoteToolDef {
	description: string;
	name: string;
	parameters: JsonSchema;
}

export function buildRemoteToolDefs(
	defs: RemoteToolDef[],
	store: PendingToolCallStore
): ToolDef[] {
	return defs.map((def) => ({
		name: def.name,
		description: def.description,
		parameters: def.parameters,
		execute: (_args, ctx) =>
			store.park({
				sessionId: ctx.sessionId,
				callId: ctx.callId,
				abortSignal: ctx.abortSignal,
			}),
	}));
}
