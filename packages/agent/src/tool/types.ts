export interface ExecuteResult {
	isError?: boolean;
	output: string;
}

export interface ToolContext {
	abortSignal: AbortSignal;
	agentId: string;
	callId: string;
	messageId: string;
	sessionId: string;
}

export type JsonSchema = Record<string, unknown>;

export interface ToolDef {
	/** Bulky/optional tool: its schema is hidden from the model until
	 * search_tools surfaces it. Only takes effect past the defer threshold. */
	defer?: boolean;
	description: string;
	execute(args: unknown, ctx: ToolContext): Promise<ExecuteResult>;
	name: string;
	parameters: JsonSchema;
}
