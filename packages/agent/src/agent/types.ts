export interface AgentParams {
	maxOutputTokens: number | null;
	temperature: number | null;
	topP: number | null;
}

export interface AgentConfig {
	builtinTools: string[];
	composioAccountIds: string[];
	createdAt: Date;
	description: string;
	id: string;
	mcpServerIds: string[];
	modelId: string;
	name: string;
	params: AgentParams | null;
	providerId: string;
	systemPrompt: string;
	/** Tool-name allowlist; null = all tools of the linked sources. */
	toolAllowlist: string[] | null;
	updatedAt: Date;
	/** Owner (creator) id; null for legacy/global agents. */
	userId: string | null;
}

/** 创建/更新输入：无 id、无时间戳（由存储层生成）。 */
export interface AgentInput {
	builtinTools: string[];
	composioAccountIds: string[];
	description: string;
	mcpServerIds: string[];
	modelId: string;
	name: string;
	params: AgentParams | null;
	providerId: string;
	systemPrompt: string;
	toolAllowlist?: string[] | null;
}
