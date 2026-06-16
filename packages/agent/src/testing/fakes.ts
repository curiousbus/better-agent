import type {
	ModelCacheStore,
	ProviderCatalogStore,
	ProviderCredentialStore,
} from "../ports";
import type {
	ModelEntry,
	ProviderCatalogEntry,
	ProviderCredential,
} from "../provider/types";

export function createFakeCatalogStore(): ProviderCatalogStore {
	let entries: ProviderCatalogEntry[] = [];
	return {
		replaceAll(next) {
			entries = next;
			return Promise.resolve();
		},
		list() {
			return Promise.resolve(entries);
		},
		get(providerId) {
			return Promise.resolve(
				entries.find((e) => e.providerId === providerId) ?? null
			);
		},
	};
}

export function createFakeModelStore(): ModelCacheStore {
	let entries: ModelEntry[] = [];
	return {
		replaceAll(next) {
			entries = next;
			return Promise.resolve();
		},
		listByProvider(providerId) {
			return Promise.resolve(
				entries.filter((e) => e.providerId === providerId)
			);
		},
		get(providerId, modelId) {
			return Promise.resolve(
				entries.find(
					(e) => e.providerId === providerId && e.modelId === modelId
				) ?? null
			);
		},
	};
}

export function createFakeCredentialStore(
	seed: ProviderCredential[] = []
): ProviderCredentialStore {
	const map = new Map(seed.map((c) => [c.providerId, c]));
	return {
		upsert(input) {
			map.set(input.providerId, input);
			return Promise.resolve();
		},
		delete(providerId) {
			map.delete(providerId);
			return Promise.resolve();
		},
		listMasked() {
			return Promise.resolve(
				[...map.values()].map(({ apiKey, ...rest }) => ({
					...rest,
					last4: apiKey.slice(-4),
				}))
			);
		},
		get(providerId) {
			return Promise.resolve(map.get(providerId) ?? null);
		},
	};
}
