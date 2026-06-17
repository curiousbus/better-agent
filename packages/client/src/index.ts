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
	/** 本 client 绑定的 agent（创建 session 时用）。 */
	agentId: string;
	/** server 根地址，如 "http://localhost:3000"；SDK 自动拼 "/rpc"。 */
	baseURL: string;
}

export interface RunOptions {
	/** 继续指定会话；省略则自动新建一次性会话。 */
	sessionId?: string;
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
export function createAgentClientFrom(
	client: Client,
	agentId: string
): AgentClient {
	const ensureSession = async (sessionId?: string): Promise<string> =>
		sessionId ?? (await client.sessions.create({ agentId })).id;
	return {
		async createSession() {
			const session = await client.sessions.create({ agentId });
			return { sessionId: session.id };
		},
		async run(text, options) {
			const sessionId = await ensureSession(options?.sessionId);
			return client.sessions.run({ sessionId, text });
		},
		async *stream(text, options) {
			const sessionId = await ensureSession(options?.sessionId);
			const events = await client.sessions.prompt({ sessionId, text });
			for await (const event of events) {
				yield event;
			}
		},
		listMessages(sessionId) {
			return client.sessions.listMessages({ sessionId });
		},
	};
}

/** 创建一个绑定 baseURL + agentId 的 Agent SDK client。 */
export function createAgentClient(config: AgentClientConfig): AgentClient {
	const link = new RPCLink({ url: `${config.baseURL}/rpc` });
	const client = createORPCClient(link) as Client;
	return createAgentClientFrom(client, config.agentId);
}
