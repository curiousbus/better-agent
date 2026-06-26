import type { SecretBox } from "@better-agent/agent/crypto/secret-box";
import type {
	ComposioAccountRow,
	ComposioAccountStore,
} from "@better-agent/agent/ports";
import { desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const LAST4 = 4;

function toRow(
	row: typeof schema.composioAccounts.$inferSelect
): ComposioAccountRow {
	return {
		id: row.id,
		name: row.name,
		apiKeyLast4: row.apiKeyLast4,
		createdAt: row.createdAt,
	};
}

export function createComposioAccountStore(
	db: Db,
	box: SecretBox
): ComposioAccountStore {
	const findRow = async (id: string) => {
		const rows = await db
			.select()
			.from(schema.composioAccounts)
			.where(eq(schema.composioAccounts.id, id))
			.limit(1);
		return rows[0] ?? null;
	};

	return {
		async list() {
			const rows = await db
				.select()
				.from(schema.composioAccounts)
				.orderBy(desc(schema.composioAccounts.createdAt));
			return rows.map(toRow);
		},
		async getById(id) {
			const row = await findRow(id);
			return row ? toRow(row) : null;
		},
		async getApiKey(id) {
			const row = await findRow(id);
			return row ? box.decrypt(row.apiKeyCipher) : null;
		},
		async create({ name, apiKey }) {
			const inserted = await db
				.insert(schema.composioAccounts)
				.values({
					name,
					apiKeyCipher: box.encrypt(apiKey),
					apiKeyLast4: apiKey.slice(-LAST4),
				})
				.returning();
			const row = inserted[0];
			if (!row) {
				throw new Error("Failed to create composio account");
			}
			return toRow(row);
		},
		async delete(id) {
			await db
				.delete(schema.composioAccounts)
				.where(eq(schema.composioAccounts.id, id));
		},
	};
}
