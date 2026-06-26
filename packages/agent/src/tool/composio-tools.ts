import type { ExecuteResult, JsonSchema, ToolDef } from "./types";

export interface ComposioToolMeta {
	description: string;
	name: string;
	parameters: JsonSchema;
}

export interface ComposioService {
	/** Execute one composio tool server-side for this user. */
	execute(input: {
		userId: string;
		toolName: string;
		args: unknown;
	}): Promise<ExecuteResult>;
	/** List the composio tools available to this user (scoped to the given toolkits). */
	listTools(userId: string, toolkits: string[]): Promise<ComposioToolMeta[]>;
}

/** Turn composio tool metas into runtime ToolDefs whose execute calls the service. */
export async function buildComposioToolDefs(
	service: ComposioService,
	userId: string,
	toolkits: string[]
): Promise<ToolDef[]> {
	const metas = await service.listTools(userId, toolkits);
	return metas.map((meta) => ({
		name: meta.name,
		description: meta.description,
		parameters: meta.parameters,
		execute: (args) => service.execute({ userId, toolName: meta.name, args }),
	}));
}
