export interface AgentParams {
	maxOutputTokens: number | null;
	temperature: number | null;
	topP: number | null;
}

export interface AgentConfig {
	createdAt: Date;
	description: string;
	id: string;
	modelId: string;
	name: string;
	params: AgentParams | null;
	providerId: string;
	systemPrompt: string;
	updatedAt: Date;
}

/** 创建/更新输入：无 id、无时间戳（由存储层生成）。 */
export interface AgentInput {
	description: string;
	modelId: string;
	name: string;
	params: AgentParams | null;
	providerId: string;
	systemPrompt: string;
}
