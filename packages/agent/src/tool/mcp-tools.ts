import type { ExecuteResult, JsonSchema, ToolDef } from "./types";

export interface McpToolMeta {
	description: string;
	name: string;
	parameters: JsonSchema;
}

/** A connected remote MCP server, scoped to one stored server config. */
export interface McpService {
	execute(input: { toolName: string; args: unknown }): Promise<ExecuteResult>;
	listTools(): Promise<McpToolMeta[]>;
}

/** Turn MCP tool metas into runtime ToolDefs whose execute calls the server. */
export async function buildMcpToolDefs(
	service: McpService
): Promise<ToolDef[]> {
	const metas = await service.listTools();
	return metas.map((meta) => ({
		name: meta.name,
		description: meta.description,
		parameters: meta.parameters,
		execute: (args) => service.execute({ toolName: meta.name, args }),
	}));
}
