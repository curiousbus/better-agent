import { z } from "zod";
import type { ModelEntry, ProviderCatalogEntry } from "./types";

const ModelSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	tool_call: z.boolean().optional(),
	reasoning: z.boolean().optional(),
	modalities: z.object({ input: z.array(z.string()).optional() }).optional(),
	cost: z
		.object({ input: z.number().optional(), output: z.number().optional() })
		.optional(),
	limit: z
		.object({ context: z.number().optional(), output: z.number().optional() })
		.optional(),
});

const ProviderSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	npm: z.string().optional(),
	api: z.string().optional(),
	env: z.array(z.string()).optional(),
	models: z.record(z.string(), ModelSchema).default({}),
});

const ApiSchema = z.record(z.string(), ProviderSchema);

const MODELS_DEV_URL = "https://models.dev/api.json";

type RawModel = z.infer<typeof ModelSchema>;

function toCapabilities(model: RawModel): ModelEntry["capabilities"] {
	return {
		toolCall: model.tool_call ?? false,
		reasoning: model.reasoning ?? false,
		vision: model.modalities?.input?.includes("image") ?? false,
	};
}

function toModelEntry(providerId: string, model: RawModel): ModelEntry {
	return {
		providerId,
		modelId: model.id,
		name: model.name ?? model.id,
		contextLimit: model.limit?.context ?? null,
		maxOutputTokens: model.limit?.output ?? null,
		inputPricePerM: model.cost?.input ?? null,
		outputPricePerM: model.cost?.output ?? null,
		capabilities: toCapabilities(model),
	};
}

export function parseModelsDev(
	raw: unknown,
	allowedProviders?: string[]
): { providers: ProviderCatalogEntry[]; models: ModelEntry[] } {
	const parsed = ApiSchema.parse(raw);
	const allow = allowedProviders ? new Set(allowedProviders) : null;
	const providers: ProviderCatalogEntry[] = [];
	const models: ModelEntry[] = [];

	for (const [providerId, provider] of Object.entries(parsed)) {
		if (allow && !allow.has(providerId)) {
			continue;
		}
		providers.push({
			providerId,
			name: provider.name ?? providerId,
			npm: provider.npm ?? null,
			defaultBaseURL: provider.api ?? null,
			envKeys: provider.env ?? [],
		});
		for (const model of Object.values(provider.models)) {
			models.push(toModelEntry(providerId, model));
		}
	}

	return { providers, models };
}

export async function fetchModelsDev(
	url: string = MODELS_DEV_URL
): Promise<unknown> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`models.dev fetch failed: ${response.status}`);
	}
	return response.json();
}
