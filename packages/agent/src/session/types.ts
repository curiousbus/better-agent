/** Session 生命周期状态。error 表示上一轮运行失败。 */
export type SessionStatus = "active" | "error";

export interface Session {
	/** 创建时绑定的 agent，不可改。 */
	agentId: string;
	/** 📐 已压缩到的 message.seq（含）；P2 compaction 写入。 */
	compactedThroughSeq: number | null;
	createdAt: Date;
	id: string;
	status: SessionStatus;
	/** 📐 压缩摘要（P2 compaction 写入）。 */
	summary: string | null;
	/** 首条 user 消息自动摘要；未生成前为 null。 */
	title: string | null;
	updatedAt: Date;
}

export interface SessionInput {
	agentId: string;
}

export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus =
	| "pending"
	| "streaming"
	| "complete"
	| "error"
	| "aborted";

export type FinishReason = "stop" | "length" | "tool-calls" | "error";

export interface MessageUsage {
	inputTokens: number | null;
	outputTokens: number | null;
	totalTokens: number | null;
}

export type ErrorCategory =
	| "retryable"
	| "content-filter"
	| "fatal"
	| "aborted";

export interface MessageError {
	category?: ErrorCategory;
	message: string;
}

export interface Message {
	createdAt: Date;
	error: MessageError | null;
	finishReason: FinishReason | null;
	id: string;
	modelId: string | null;
	/** assistant 实际所用模型；user/system 为 null。 */
	providerId: string | null;
	role: MessageRole;
	/** 会话内单调递增，从 0 开始。 */
	seq: number;
	sessionId: string;
	status: MessageStatus;
	updatedAt: Date;
	usage: MessageUsage | null;
}

export interface MessageInput {
	modelId: string | null;
	providerId: string | null;
	role: MessageRole;
	sessionId: string;
	status: MessageStatus;
}

/** 增量更新 assistant 消息：只带要改的字段。 */
export interface MessagePatch {
	error?: MessageError | null;
	finishReason?: FinishReason | null;
	modelId?: string | null;
	providerId?: string | null;
	status?: MessageStatus;
	usage?: MessageUsage | null;
}

export type MessagePartType =
	| "text"
	| "reasoning"
	| "tool-call"
	| "tool-result";

export type PartStatus = "streaming" | "complete" | "error";

export interface TextPartContent {
	text: string;
}

export interface ReasoningPartContent {
	text: string;
}

/** 📐 工具阶段写入，P1 不产生。 */
export interface ToolCallPartContent {
	args: unknown;
	callId: string;
	toolName: string;
}

/** 📐 工具阶段写入，P1 不产生。 */
export interface ToolResultPartContent {
	callId: string;
	isError: boolean;
	result: unknown;
}

export type MessagePartContent =
	| TextPartContent
	| ReasoningPartContent
	| ToolCallPartContent
	| ToolResultPartContent;

interface MessagePartBase {
	createdAt: Date;
	id: string;
	messageId: string;
	/** 消息内单调递增，从 0 开始。 */
	seq: number;
	status: PartStatus;
	updatedAt: Date;
}

/** 判别联合：`type` 与 `content` 形状一一对应，消费端可按 type 收窄。 */
export type MessagePart =
	| (MessagePartBase & { type: "text"; content: TextPartContent })
	| (MessagePartBase & { type: "reasoning"; content: ReasoningPartContent })
	| (MessagePartBase & { type: "tool-call"; content: ToolCallPartContent })
	| (MessagePartBase & {
			type: "tool-result";
			content: ToolResultPartContent;
	  });

export interface MessagePartInput {
	content: MessagePartContent;
	messageId: string;
	status: PartStatus;
	type: MessagePartType;
}

export interface MessagePartPatch {
	content?: MessagePartContent;
	status?: PartStatus;
}

/** 一条消息及其按 seq 升序的 parts。 */
export interface MessageWithParts {
	message: Message;
	parts: MessagePart[];
}
