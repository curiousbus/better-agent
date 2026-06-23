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

export interface AgentClientConfig {
	/** server 根地址，如 "http://localhost:3000"；SDK 自动拼 "/rpc"。 */
	baseURL: string;
	/** agent token（创建 agent 时返回，并持久化在服务端）。SDK 以 Bearer 头携带。 */
	token: string;
}

export interface RunOptions {
	/** 继续指定会话；省略则自动新建一次性会话。 */
	sessionId?: string;
	/** 中止信号：用于取消进行中的 run/stream。 */
	signal?: AbortSignal;
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

/** 用已有 oRPC client 构造 SDK（便于注入测试）。 */
export function createAgentClientFrom(client: Client): AgentClient {
	const ensureSession = async (sessionId?: string): Promise<string> =>
		sessionId ?? (await client.sessions.create({})).id;
	return {
		async createSession() {
			const session = await client.sessions.create({});
			return { sessionId: session.id };
		},
		async run(text, options) {
			const sessionId = await ensureSession(options?.sessionId);
			return client.sessions.run(
				{ sessionId, text },
				{ signal: options?.signal }
			);
		},
		async *stream(text, options) {
			const sessionId = await ensureSession(options?.sessionId);
			const events = await client.sessions.prompt(
				{ sessionId, text },
				{ signal: options?.signal }
			);
			for await (const event of events) {
				yield event;
			}
		},
		listMessages(sessionId) {
			return client.sessions.listMessages({ sessionId });
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
