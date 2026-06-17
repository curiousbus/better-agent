import type { AgentValidator } from "@better-agent/agent/agent/agent-validator";
import type {
	AgentStore,
	ModelCacheStore,
	ProviderCatalogStore,
	ProviderCredentialStore,
} from "@better-agent/agent/ports";
import type { ModelCatalog } from "@better-agent/agent/provider/model-catalog";
import type { ModelFactory } from "@better-agent/agent/provider/model-factory";

export interface AgentServices {
	agentValidator: AgentValidator;
	catalog: ModelCatalog;
	modelFactory: ModelFactory;
	stores: {
		providerCatalog: ProviderCatalogStore;
		modelCache: ModelCacheStore;
		providerCredential: ProviderCredentialStore;
		agent: AgentStore;
	};
}
