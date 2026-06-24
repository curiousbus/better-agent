import type { AppRouter } from "@better-agent/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

type Client = RouterClient<AppRouter>;

/** 最终 assistant 消息（从 sessions.run 推断，避免依赖 packages/agent）。 */
export type Message = Awaited<ReturnType<Client["sessions"]["run"]>>;

/** 会话历史（从 sessions.listMessages 推断）。 */
export type MessageHistory = Awaited<
	ReturnType<Client["sessions"]["listMessages"]>
>;

type PromptStream = Awaited<ReturnType<Client["sessions"]["prompt"]>>;

/** 流式运行事件（从 sessions.prompt 的 event iterator 推断）。 */
export type RunEvent = PromptStream extends AsyncIterable<infer E> ? E : never;

/** A locally-executable tool definition for the client SDK. */
export interface ClientToolDef {
	description: string;
	execute(args: unknown): Promise<string>;
	name: string;
	parameters: Record<string, unknown>;
}

export interface AgentClientConfig {
	/** server 根地址，如 "http://localhost:3000"；SDK 自动拼 "/rpc"。 */
	baseURL: string;
	/** agent token（创建 agent 时返回，并持久化在服务端）。SDK 以 Bearer 头携带。 */
	token: string;
}

export interface RunOptions {
	/** JSON Schema for structured output; the server will return a structured field. */
	outputSchema?: Record<string, unknown>;
	/** 继续指定会话；省略则自动新建一次性会话。 */
	sessionId?: string;
	/** 中止信号：用于取消进行中的 run/stream。 */
	signal?: AbortSignal;
	/** Local tool definitions to execute on tool-call events from the server. */
	tools?: ClientToolDef[];
}

export interface AgentClient {
	/** 新建一个绑定本 client agent 的会话。 */
	createSession(): Promise<{ sessionId: string }>;
	/** 回放会话全部消息及其 parts。 */
	listMessages(sessionId: string): Promise<MessageHistory>;
	/** 跑一轮，返回最终 assistant 消息（无 sessionId 则自动建会话）。 */
	run(text: string, options?: RunOptions): Promise<Message>;
	/** 跑一轮并流式返回运行事件（无 sessionId 则自动建会话）。 */
	stream(text: string, options?: RunOptions): AsyncGenerator<RunEvent>;
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
): Promise<Message> {
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
	return { ...lastAssistant.message, structured } as Message;
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

/** 用已有 oRPC client 构造 SDK（便于注入测试）。 */
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
	};

	return agentClient;
}

/** 用已有 oRPC client 构造用户平面 SDK（以 userSessions 路由驱动，绑定 agentId）。 */
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
	};
}

/** 创建一个绑定 baseURL + token 的 Agent SDK client。 */
export function createAgentClient(config: AgentClientConfig): AgentClient {
	const link = new RPCLink({
		url: `${config.baseURL}/rpc`,
		headers: { authorization: `Bearer ${config.token}` },
	});
	const client = createORPCClient(link) as Client;
	return createAgentClientFrom(client);
}
