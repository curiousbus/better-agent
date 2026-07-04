import type {
	BridgeSessionRow,
	BridgeSessionStore,
} from "@better-agent/agent/ports";
import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function toRow(
	row: typeof schema.bridgeSessions.$inferSelect
): BridgeSessionRow {
	return {
		id: row.id,
		userId: row.userId,
		tokenId: row.tokenId,
		agentKind: row.agentKind,
		label: row.label ?? null,
		status: row.status,
		createdAt: row.createdAt,
		lastSeenAt: row.lastSeenAt,
	};
}

export function createBridgeSessionStore(db: Db): BridgeSessionStore {
	return {
		async create({ userId, tokenId, agentKind, label }) {
			const rows = await db
				.insert(schema.bridgeSessions)
				.values({ userId, tokenId, agentKind, label })
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create bridge session");
			}
			return toRow(row);
		},
		async get(id) {
			const rows = await db
				.select()
				.from(schema.bridgeSessions)
				.where(eq(schema.bridgeSessions.id, id))
				.limit(1);
			const row = rows[0];
			return row ? toRow(row) : null;
		},
		async listByUser(userId) {
			const rows = await db
				.select()
				.from(schema.bridgeSessions)
				.where(eq(schema.bridgeSessions.userId, userId));
			return rows.map(toRow);
		},
		async touch(id) {
			await db
				.update(schema.bridgeSessions)
				.set({ lastSeenAt: new Date() })
				.where(eq(schema.bridgeSessions.id, id));
		},
		async end(id, userId) {
			await db
				.update(schema.bridgeSessions)
				.set({ status: "ended" })
				.where(
					and(
						eq(schema.bridgeSessions.id, id),
						eq(schema.bridgeSessions.userId, userId)
					)
				);
		},
	};
}
