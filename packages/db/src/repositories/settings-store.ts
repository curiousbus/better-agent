import type { SecretBox } from "@better-agent/agent/crypto/secret-box";
import type { SettingsStore } from "@better-agent/agent/ports";
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createSettingsStore(db: Db, box: SecretBox): SettingsStore {
	return {
		async get(key) {
			const rows = await db
				.select()
				.from(schema.settings)
				.where(eq(schema.settings.key, key))
				.limit(1);
			const row = rows[0];
			return row ? box.decrypt(row.valueCipher) : null;
		},
		async set(key, value) {
			const valueCipher = box.encrypt(value);
			await db
				.insert(schema.settings)
				.values({ key, valueCipher, updatedAt: new Date() })
				.onConflictDoUpdate({
					target: schema.settings.key,
					set: { valueCipher, updatedAt: new Date() },
				});
		},
		async delete(key) {
			await db.delete(schema.settings).where(eq(schema.settings.key, key));
		},
	};
}
