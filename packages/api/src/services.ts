import type {
	ModelCacheStore,
	ProviderCatalogStore,
	ProviderCredentialStore,
} from "@better-agent/agent/ports";
import type { ModelCatalog } from "@better-agent/agent/provider/model-catalog";
import type { ModelFactory } from "@better-agent/agent/provider/model-factory";

export interface AgentServices {
	catalog: ModelCatalog;
	modelFactory: ModelFactory;
	stores: {
		modelCache: ModelCacheStore;
		providerCatalog: ProviderCatalogStore;
		providerCredential: ProviderCredentialStore;
	};
}
