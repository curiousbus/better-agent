import type { AgentConfig, AgentInput } from "./agent/types";
import type {
	ModelEntry,
	ProviderCatalogEntry,
	ProviderCredential,
} from "./provider/types";

export interface ProviderCatalogStore {
	get(providerId: string): Promise<ProviderCatalogEntry | null>;
	list(): Promise<ProviderCatalogEntry[]>;
	replaceAll(entries: ProviderCatalogEntry[]): Promise<void>;
}

export interface ModelCacheStore {
	get(providerId: string, modelId: string): Promise<ModelEntry | null>;
	listByProvider(providerId: string): Promise<ModelEntry[]>;
	replaceAll(entries: ModelEntry[]): Promise<void>;
}

/** 注意：`get` 返回**已解密**的 apiKey；加解密在仓储实现里完成。 */
export interface ProviderCredentialStore {
	delete(providerId: string): Promise<void>;
	get(providerId: string): Promise<ProviderCredential | null>;
	/** 列表用，apiKey 字段被脱敏成末四位。 */
	listMasked(): Promise<
		Array<Omit<ProviderCredential, "apiKey"> & { last4: string }>
	>;
	upsert(input: ProviderCredential): Promise<void>;
}

export interface AgentStore {
	create(input: AgentInput): Promise<AgentConfig>;
	delete(id: string): Promise<void>;
	get(id: string): Promise<AgentConfig | null>;
	list(): Promise<AgentConfig[]>;
	update(id: string, input: AgentInput): Promise<AgentConfig | null>;
}
