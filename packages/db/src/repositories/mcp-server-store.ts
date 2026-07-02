import type { SecretBox } from "@better-agent/agent/crypto/secret-box";
import type { McpServerRow, McpServerStore } from "@better-agent/agent/ports";
import { desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const LAST4 = 4;

function toRow(row: typeof schema.mcpServers.$inferSelect): McpServerRow {
	return {
		id: row.id,
		userId: row.userId,
		name: row.name,
		url: row.url,
		authLast4: row.authLast4 ?? null,
		createdAt: row.createdAt,
	};
}

export function createMcpServerStore(db: Db, box: SecretBox): McpServerStore {
	const findRow = async (id: string) => {
		const rows = await db
			.select()
			.from(schema.mcpServers)
			.where(eq(schema.mcpServers.id, id))
			.limit(1);
		return rows[0] ?? null;
	};

	return {
		async listByUser(userId) {
			const rows = await db
				.select()
				.from(schema.mcpServers)
				.where(eq(schema.mcpServers.userId, userId))
				.orderBy(desc(schema.mcpServers.createdAt));
			return rows.map(toRow);
		},
		async getById(id) {
			const row = await findRow(id);
			return row ? toRow(row) : null;
		},
		async getAuthHeader(id) {
			const row = await findRow(id);
			return row?.authHeaderCipher ? box.decrypt(row.authHeaderCipher) : null;
		},
		async create({ name, url, authHeader, userId }) {
			const inserted = await db
				.insert(schema.mcpServers)
				.values({
					name,
					url,
					userId,
					authHeaderCipher: authHeader ? box.encrypt(authHeader) : null,
					authLast4: authHeader ? authHeader.slice(-LAST4) : null,
				})
				.returning();
			const row = inserted[0];
			if (!row) {
				throw new Error("Failed to create MCP server");
			}
			return toRow(row);
		},
		async delete(id) {
			await db.delete(schema.mcpServers).where(eq(schema.mcpServers.id, id));
		},
	};
}
