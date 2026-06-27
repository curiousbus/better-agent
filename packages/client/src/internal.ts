import type { AppRouter } from "@better-agent/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

import type {
	AgentClient,
	AgentClientConfig,
	ClientToolDef,
	RunEvent,
	RunOptions,
	RunResult,
} from "./types";

/** The fully-typed oRPC client for the server router. Workspace-internal. */
type Client = RouterClient<AppRouter>;

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

function stripToolDefs(tools: ClientToolDef[]): {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}[] {
	return tools.map(({ name, description, parameters }) => ({
		name,
		description,
		parameters,
	}));
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
	const toolDefs = options?.tools ? stripToolDefs(options.tools) : undefined;
	const events = await client.sessions.prompt(
		{ sessionId, text, tools: toolDefs, outputSchema: options?.outputSchema },
		{ signal: options?.signal }
	);
	const dispatches: Promise<void>[] = [];
	for await (const event of events) {
		yield event;
		if (event.type === "tool-call" && options?.tools) {
			const tools = options.tools;
			const dispatch = dispatchToolCall(tools, event, (r) =>
				client.sessions
					.submitToolResult({
						sessionId,
						callId: r.callId,
						result: r.result,
						isError: r.isError,
					})
					.then(() => undefined)
			);
			dispatches.push(dispatch);
		}
	}
	await Promise.all(dispatches);
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
				{ sessionId, text, outputSchema: options?.outputSchema },
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

		async cancel(sessionId) {
			await client.sessions.cancel({ sessionId });
		},
	};

	return agentClient;
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
				{ sessionId, text, outputSchema: options?.outputSchema },
				{ signal: options?.signal }
			);
		},
		async *stream(text, options) {
			const sessionId = await ensureSession(options?.sessionId);
			const events = await client.userSessions.prompt(
				{ sessionId, text, outputSchema: options?.outputSchema },
				{ signal: options?.signal }
			);
			for await (const event of events) {
				yield event;
			}
		},
		listMessages(sessionId) {
			return client.userSessions.listMessages({ sessionId });
		},

		async cancel(sessionId) {
			await client.userSessions.cancel({ sessionId });
		},
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
