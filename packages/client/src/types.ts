import type { RunEvent } from "@better-agent/agent/session/events";
import type {
	Message,
	MessageWithParts,
} from "@better-agent/agent/session/types";

// Re-export the canonical session domain types so the SDK's public surface is
// self-contained — these are the exact shapes the server returns.
export type { RunEvent } from "@better-agent/agent/session/events";
export type {
	Message,
	MessageError,
	MessagePart,
	MessagePartContent,
	MessageRole,
	MessageStatus,
	MessageUsage,
} from "@better-agent/agent/session/types";

/** Final assistant message returned by `run()`, plus any structured output. */
export type RunResult = Message & { structured: unknown };

/** Full session history: each message paired with its ordered parts. */
export type MessageHistory = MessageWithParts[];

/** A locally-executable tool definition for the client SDK. */
export interface ClientToolDef {
	description: string;
	execute(args: unknown): Promise<string>;
	name: string;
	parameters: Record<string, unknown>;
}

export interface AgentClientConfig {
	/** server root, e.g. "http://localhost:3000"; the SDK appends "/rpc". */
	baseURL: string;
	/** agent token (returned when an agent is created). Sent as a Bearer header. */
	token: string;
}

export interface RunOptions {
	/** Ids of attachments (from `uploadAttachment`) to send with this turn. */
	attachmentIds?: string[];
	/** JSON Schema for structured output; the server returns a `structured` field. */
	outputSchema?: Record<string, unknown>;
	/** Continue an existing session; omit to auto-create a one-shot session. */
	sessionId?: string;
	/** Abort signal: cancels an in-flight run/stream. */
	signal?: AbortSignal;
	/** Opt-in surfaces (e.g. ["board"]) that bind that surface's server tools for this turn. */
	surfaces?: string[];
	/** Local tool definitions to execute on tool-call events from the server. */
	tools?: ClientToolDef[];
}

/** Metadata for an uploaded attachment, returned by `uploadAttachment`. */
export interface UploadedAttachment {
	id: string;
	mime: string;
	name: string;
	size: number;
}

export interface ToolCallRequest {
	args: Record<string, unknown>;
	callId: string;
	name: string;
}

export interface ToolCallResult {
	callId: string;
	isError: boolean;
	name: string;
	result: unknown;
}

export interface AgentClient {
	/** Cancel the in-flight turn for a session (server-side cancellation). */
	cancel(sessionId: string): Promise<void>;
	/** Create a new session bound to this client's agent. */
	createSession(): Promise<{ sessionId: string }>;
	/** Fetch an uploaded attachment's bytes (e.g. to render an image). */
	getAttachment(id: string): Promise<Blob>;
	/** Replay a session's full message history with parts. */
	listMessages(sessionId: string): Promise<MessageHistory>;
	/** Run one turn, returning the final assistant message (auto-creates a session if omitted). */
	run(text: string, options?: RunOptions): Promise<RunResult>;
	/** Submit a single tool result and return its parsed value (throws on isError). */
	runTool(
		sessionId: string,
		name: string,
		args: Record<string, unknown>
	): Promise<unknown>;
	/** Submit multiple tool results back to the server; calls onResult for each in arrival order. */
	runTools(
		sessionId: string,
		calls: ToolCallRequest[],
		onResult: (result: ToolCallResult) => void
	): Promise<void>;
	/** Run one turn, streaming run events (auto-creates a session if omitted). */
	stream(text: string, options?: RunOptions): AsyncGenerator<RunEvent>;
	/** Upload an image/file for a session; returns its id to pass as an attachmentId. */
	uploadAttachment(sessionId: string, file: File): Promise<UploadedAttachment>;
}
