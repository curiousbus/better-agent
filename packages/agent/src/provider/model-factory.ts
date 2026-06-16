import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ProviderCatalogStore, ProviderCredentialStore } from "../ports";
import { loadAdapter } from "./adapter-loader";

export interface ModelFactoryDeps {
	catalogStore: ProviderCatalogStore;
	credentialStore: ProviderCredentialStore;
}

export interface ModelFactory {
	create(providerId: string, modelId: string): Promise<LanguageModelV3>;
}

export function createModelFactory(deps: ModelFactoryDeps): ModelFactory {
	return {
		async create(providerId, modelId) {
			const provider = await deps.catalogStore.get(providerId);
			if (!provider) {
				throw new Error(`Unknown provider: ${providerId}`);
			}
			const credential = await deps.credentialStore.get(providerId);
			if (!credential?.enabled) {
				throw new Error(`No enabled credential for provider: ${providerId}`);
			}
			if (!provider.npm) {
				throw new Error(`Provider ${providerId} has no npm adapter`);
			}
			const make = await loadAdapter(provider.npm, {
				apiKey: credential.apiKey,
				baseURL: credential.baseURL ?? provider.defaultBaseURL,
			});
			return make(modelId);
		},
	};
}
