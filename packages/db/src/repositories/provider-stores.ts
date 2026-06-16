import type { SecretBox } from "@better-agent/agent/crypto/secret-box";
import type {
	ModelCacheStore,
	ProviderCatalogStore,
	ProviderCredentialStore,
} from "@better-agent/agent/ports";
import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const LAST4_SUFFIX = -4;

export function createProviderCatalogStore(db: Db): ProviderCatalogStore {
	return {
		async replaceAll(entries) {
			await db.transaction(async (tx) => {
				await tx.delete(schema.providersCatalog);
				if (entries.length > 0) {
					await tx.insert(schema.providersCatalog).values(entries);
				}
			});
		},
		list() {
			return db.select().from(schema.providersCatalog);
		},
		async get(providerId) {
			const rows = await db
				.select()
				.from(schema.providersCatalog)
				.where(eq(schema.providersCatalog.providerId, providerId))
				.limit(1);
			return rows[0] ?? null;
		},
	};
}

export function createModelCacheStore(db: Db): ModelCacheStore {
	return {
		async replaceAll(entries) {
			await db.transaction(async (tx) => {
				await tx.delete(schema.modelsCache);
				if (entries.length > 0) {
					await tx.insert(schema.modelsCache).values(entries);
				}
			});
		},
		listByProvider(providerId) {
			return db
				.select()
				.from(schema.modelsCache)
				.where(eq(schema.modelsCache.providerId, providerId));
		},
		async get(providerId, modelId) {
			const rows = await db
				.select()
				.from(schema.modelsCache)
				.where(
					and(
						eq(schema.modelsCache.providerId, providerId),
						eq(schema.modelsCache.modelId, modelId)
					)
				)
				.limit(1);
			return rows[0] ?? null;
		},
	};
}

async function upsertCredential(
	db: Db,
	box: SecretBox,
	input: Parameters<ProviderCredentialStore["upsert"]>[0]
): Promise<void> {
	const values = {
		providerId: input.providerId,
		apiKeyCipher: box.encrypt(input.apiKey),
		baseURL: input.baseURL,
		enabled: input.enabled,
		updatedAt: new Date(),
	};
	await db
		.insert(schema.providerCredentials)
		.values(values)
		.onConflictDoUpdate({
			target: schema.providerCredentials.providerId,
			set: {
				apiKeyCipher: values.apiKeyCipher,
				baseURL: values.baseURL,
				enabled: values.enabled,
				updatedAt: values.updatedAt,
			},
		});
}

async function getCredential(
	db: Db,
	box: SecretBox,
	providerId: string
): ReturnType<ProviderCredentialStore["get"]> {
	const rows = await db
		.select()
		.from(schema.providerCredentials)
		.where(eq(schema.providerCredentials.providerId, providerId))
		.limit(1);
	const row = rows[0];
	if (!row) {
		return null;
	}
	return {
		providerId: row.providerId,
		apiKey: box.decrypt(row.apiKeyCipher),
		baseURL: row.baseURL,
		enabled: row.enabled,
	};
}

export function createProviderCredentialStore(
	db: Db,
	box: SecretBox
): ProviderCredentialStore {
	return {
		upsert: (input) => upsertCredential(db, box, input),
		async delete(providerId) {
			await db
				.delete(schema.providerCredentials)
				.where(eq(schema.providerCredentials.providerId, providerId));
		},
		async listMasked() {
			const rows = await db.select().from(schema.providerCredentials);
			return rows.map((row) => ({
				providerId: row.providerId,
				baseURL: row.baseURL,
				enabled: row.enabled,
				last4: box.decrypt(row.apiKeyCipher).slice(LAST4_SUFFIX),
			}));
		},
		get: (providerId) => getCredential(db, box, providerId),
	};
}
