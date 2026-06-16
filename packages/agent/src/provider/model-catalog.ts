import type { ModelCacheStore, ProviderCatalogStore } from "../ports";
import { parseModelsDev } from "./models-dev";

export interface ModelCatalogDeps {
	allowedProviders?: string[];
	catalogStore: ProviderCatalogStore;
	fetcher: () => Promise<unknown>;
	modelStore: ModelCacheStore;
}

export interface SyncResult {
	modelCount: number;
	ok: boolean;
	providerCount: number;
}

export interface ModelCatalog {
	sync(): Promise<SyncResult>;
}

export function createModelCatalog(deps: ModelCatalogDeps): ModelCatalog {
	return {
		async sync() {
			try {
				const raw = await deps.fetcher();
				const { providers, models } = parseModelsDev(
					raw,
					deps.allowedProviders
				);
				await deps.catalogStore.replaceAll(providers);
				await deps.modelStore.replaceAll(models);
				return {
					ok: true,
					providerCount: providers.length,
					modelCount: models.length,
				};
			} catch {
				return { ok: false, providerCount: 0, modelCount: 0 };
			}
		},
	};
}
