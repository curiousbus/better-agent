export interface ProviderCatalogEntry {
	defaultBaseURL: string | null;
	envKeys: string[];
	name: string;
	npm: string | null;
	providerId: string;
}

export interface ModelCapabilities {
	reasoning: boolean;
	toolCall: boolean;
	vision: boolean;
}

export interface ModelEntry {
	capabilities: ModelCapabilities;
	contextLimit: number | null;
	inputPricePerM: number | null;
	maxOutputTokens: number | null;
	modelId: string;
	name: string;
	outputPricePerM: number | null;
	providerId: string;
}

export interface ProviderCredential {
	apiKey: string;
	baseURL: string | null;
	enabled: boolean;
	providerId: string;
}
