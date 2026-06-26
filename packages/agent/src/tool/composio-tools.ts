import type { ExecuteResult, JsonSchema, ToolDef } from "./types";

export interface ComposioToolMeta {
	description: string;
	name: string;
	parameters: JsonSchema;
}

export interface ComposioToolkitMeta {
	description: string;
	name: string;
	needsAuth: boolean;
	slug: string;
}

export interface ComposioConnectionMeta {
	active: boolean;
	id: string;
	status: string;
	toolkitSlug: string;
}

export interface ComposioService {
	/** Initiate a connection for a user to a toolkit. Returns a redirect URL. */
	connect(userId: string, toolkit: string): Promise<{ redirectUrl: string }>;
	/** Remove a connected account by its ID. */
	disconnect(connectionId: string): Promise<void>;
	/** Execute one composio tool server-side for this user. */
	execute(input: {
		userId: string;
		toolName: string;
		args: unknown;
	}): Promise<ExecuteResult>;
	/** List all connections for a user. */
	listConnections(userId: string): Promise<ComposioConnectionMeta[]>;
	/** List the composio toolkit catalog (app-level; no per-user scope). */
	listToolkits(): Promise<ComposioToolkitMeta[]>;
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
