import type { ModelCacheStore, ProviderCredentialStore } from "../ports";

export interface AgentValidatorDeps {
	credentialStore: ProviderCredentialStore;
	modelStore: ModelCacheStore;
}

export interface AgentValidatorInput {
	modelId: string;
	providerId: string;
}

export interface AgentValidator {
	/** 返回 null 表示合法；返回错误原因字符串表示不合法。 */
	validate(input: AgentValidatorInput): Promise<string | null>;
}

export function createAgentValidator(deps: AgentValidatorDeps): AgentValidator {
	return {
		async validate({ providerId, modelId }) {
			const credential = await deps.credentialStore.get(providerId);
			if (!credential?.enabled) {
				return `Provider "${providerId}" has no enabled credential`;
			}
			const model = await deps.modelStore.get(providerId, modelId);
			if (!model) {
				return `Model "${modelId}" is not in the catalog for provider "${providerId}"`;
			}
			return null;
		},
	};
}
