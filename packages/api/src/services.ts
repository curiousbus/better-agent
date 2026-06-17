import type { AgentValidator } from "@better-agent/agent/agent/agent-validator";
import type {
	AgentStore,
	MessageStore,
	ModelCacheStore,
	ProviderCatalogStore,
	ProviderCredentialStore,
	SessionStore,
} from "@better-agent/agent/ports";
import type { ModelCatalog } from "@better-agent/agent/provider/model-catalog";
import type { ModelFactory } from "@better-agent/agent/provider/model-factory";
import type { SessionRuntime } from "@better-agent/agent/session/runtime";

export interface AgentServices {
	agentValidator: AgentValidator;
	catalog: ModelCatalog;
	modelFactory: ModelFactory;
	runtime: SessionRuntime;
	stores: {
		providerCatalog: ProviderCatalogStore;
		modelCache: ModelCacheStore;
		providerCredential: ProviderCredentialStore;
		agent: AgentStore;
		session: SessionStore;
		message: MessageStore;
	};
}
