import type { AppRouter } from "@better-agent/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

import { downscaleImage } from "./downscale";
import { streamPromptWithTools } from "./tool-stream";

import type {
	AgentClient,
	AgentClientConfig,
	ClientToolDef,
	RunEvent,
	RunOptions,
	RunResult,
	ToolCallResult,
	UploadedAttachment,
} from "./types";

interface AttachmentApi {
	getAttachment(input: { id: string }): Promise<File>;
	uploadAttachment(input: {
		file: File;
		sessionId: string;
	}): Promise<UploadedAttachment>;
}

/** Shared upload/download methods for either plane (sessions / userSessions). */
function attachmentMethods(
	api: AttachmentApi
): Pick<AgentClient, "getAttachment" | "uploadAttachment"> {
	return {
		uploadAttachment: async (sessionId, file) =>
			api.uploadAttachment({ sessionId, file: await downscaleImage(file) }),
		getAttachment: (id) => api.getAttachment({ id }),
	};
}

/** The fully-typed oRPC client for the server router. Workspace-internal. */
type Client = RouterClient<AppRouter>;

// JSON-parses string results (raw on failure); passes non-strings through.
function parseToolResult(raw: unknown): unknown {
	if (typeof raw !== "string") {
		return raw;
	}
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

function toErrorMessage(result: unknown): string {
	return typeof result === "string" ? result : JSON.stringify(result);
}

type SubmitFn = (r: {
	callId: string;
	result: string;
	isError: boolean;
}) => Promise<void>;

/**
 * Finds and executes a local tool by name from the provided tool list.
 * Calls `submit` with the result or an error — never rejects.
 */
export async function dispatchToolCall(
	tools: ClientToolDef[],
	event: { callId: string; toolName: string; args: unknown },
	submit: SubmitFn
): Promise<void> {
	const tool = tools.find((t) => t.name === event.toolName);
	if (!tool) {
		await submit({
			callId: event.callId,
			result: `Tool ${event.toolName} not found`,
			isError: true,
		});
		return;
	}
	try {
		const result = await tool.execute(event.args);
		await submit({ callId: event.callId, result, isError: false });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await submit({ callId: event.callId, result: message, isError: true });
	}
}

async function runWithTools(
	client: Client,
	stream: AgentClient["stream"],
	text: string,
	options: RunOptions & { tools: ClientToolDef[] }
): Promise<RunResult> {
	const sessionId = options.sessionId ?? (await client.sessions.create({})).id;
	let structured: unknown = null;
	for await (const event of stream(text, { ...options, sessionId })) {
		if (event.type === "done") {
			structured = (event as { structured?: unknown }).structured ?? null;
		}
	}
	const history = await client.sessions.listMessages(
		{ sessionId },
		{ signal: options.signal }
	);
	const lastAssistant = [...history]
		.reverse()
		.find((item) => item.message.role === "assistant");
	if (!lastAssistant) {
		throw new Error("No assistant message found after tool-assisted run");
	}
	return { ...lastAssistant.message, structured } as RunResult;
}

async function* streamTurn(
	client: Client,
	sessionId: string,
	text: string,
	options: RunOptions | undefined
): AsyncGenerator<RunEvent> {
	yield* streamPromptWithTools({
		sessionId,
		text,
		options,
		prompt: (input, opts) => client.sessions.prompt(input, opts),
		submit: (input) => client.sessions.submitToolResult(input),
	});
}

/** Build the SDK from an existing oRPC client (eases testing/injection). */
export function createAgentClientFrom(client: Client): AgentClient {
	const ensureSession = async (sessionId?: string): Promise<string> =>
		sessionId ?? (await client.sessions.create({})).id;

	const agentClient: AgentClient = {
		async createSession() {
			const session = await client.sessions.create({});
			return { sessionId: session.id };
		},

		async run(text, options) {
			if (options?.tools) {
				return runWithTools(client, agentClient.stream, text, {
					...options,
					tools: options.tools,
				});
			}
			const sessionId = await ensureSession(options?.sessionId);
			return client.sessions.run(
				{
					sessionId,
					text,
					outputSchema: options?.outputSchema,
					attachmentIds: options?.attachmentIds,
				},
				{ signal: options?.signal }
			);
		},

		async *stream(text, options) {
			const sessionId = await ensureSession(options?.sessionId);
			yield* streamTurn(client, sessionId, text, options);
		},

		listMessages(sessionId) {
			return client.sessions.listMessages({ sessionId });
		},

		...attachmentMethods(client.sessions),

		async cancel(sessionId) {
			await client.sessions.cancel({ sessionId });
		},

		// Direct tool execution is a user-session capability (the agent-token chat
		// plane has no `toolCalls` stream mode); reject clearly if misused here.
		runTools() {
			return Promise.reject(
				new Error("runTools is only available on user sessions")
			);
		},
		runTool() {
			return Promise.reject(
				new Error("runTool is only available on user sessions")
			);
		},
	};

	return agentClient;
}

async function userRunTools(
	client: Client,
	sessionId: string,
	calls: Parameters<AgentClient["runTools"]>[1],
	onResult: Parameters<AgentClient["runTools"]>[2]
): Promise<void> {
	const stream = await client.userSessions.prompt({
		sessionId,
		toolCalls: calls,
	});
	for await (const event of stream) {
		if (event.type === "tool-result") {
			onResult({
				callId: event.callId,
				name: event.name ?? "",
				result: parseToolResult(event.result),
				isError: event.isError,
			});
		} else if (event.type === "error") {
			throw new Error(event.message);
		}
	}
}

async function userRunTool(
	client: Client,
	sessionId: string,
	name: string,
	args: Record<string, unknown>
): Promise<unknown> {
	const callId = crypto.randomUUID();
	let captured: ToolCallResult | undefined;
	await userRunTools(client, sessionId, [{ callId, name, args }], (result) => {
		captured = result;
	});
	if (!captured) {
		throw new Error(`No result for tool ${name}`);
	}
	if (captured.isError) {
		throw new Error(toErrorMessage(captured.result));
	}
	return captured.result;
}

/** Build a user-plane SDK from an existing oRPC client (userSessions router, bound to an agentId). */
export function createUserSessionClientFrom(
	client: Client,
	agentId: string
): AgentClient {
	const ensureSession = async (sessionId?: string): Promise<string> =>
		sessionId ?? (await client.userSessions.create({ agentId })).id;

	return {
		async createSession() {
			const session = await client.userSessions.create({ agentId });
			return { sessionId: session.id };
		},
		async run(text, options) {
			const sessionId = await ensureSession(options?.sessionId);
			return client.userSessions.run(
				{
					sessionId,
					text,
					outputSchema: options?.outputSchema,
					attachmentIds: options?.attachmentIds,
				},
				{ signal: options?.signal }
			);
		},
		async *stream(text, options) {
			const sessionId = await ensureSession(options?.sessionId);
			yield* streamPromptWithTools({
				sessionId,
				text,
				options,
				prompt: (input, opts) => client.userSessions.prompt(input, opts),
				submit: (input) => client.userSessions.submitToolResult(input),
			});
		},
		listMessages(sessionId) {
			return client.userSessions.listMessages({ sessionId });
		},

		...attachmentMethods(client.userSessions),

		async cancel(sessionId) {
			await client.userSessions.cancel({ sessionId });
		},

		runTools: (sessionId, calls, onResult) =>
			userRunTools(client, sessionId, calls, onResult),
		runTool: (sessionId, name, args) =>
			userRunTool(client, sessionId, name, args),
	};
}

/** Create an Agent SDK client bound to a baseURL + token. */
export function createAgentClient(config: AgentClientConfig): AgentClient {
	const link = new RPCLink({
		url: `${config.baseURL}/rpc`,
		headers: { authorization: `Bearer ${config.token}` },
	});
	const client = createORPCClient(link) as Client;
	return createAgentClientFrom(client);
}
