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
	description: string;
	execute(args: unknown, ctx: ToolContext): Promise<ExecuteResult>;
	name: string;
	parameters: JsonSchema;
}
