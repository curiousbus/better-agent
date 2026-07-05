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
		agentSessionId: row.agentSessionId ?? null,
		status: row.status,
		createdAt: row.createdAt,
		lastSeenAt: row.lastSeenAt,
	};
}

async function touchSession(db: Db, id: string): Promise<void> {
	await db
		.update(schema.bridgeSessions)
		.set({ lastSeenAt: new Date() })
		.where(eq(schema.bridgeSessions.id, id));
}

async function setSessionAgentSessionId(
	db: Db,
	id: string,
	agentSessionId: string
): Promise<void> {
	await db
		.update(schema.bridgeSessions)
		.set({ agentSessionId })
		.where(eq(schema.bridgeSessions.id, id));
}

async function endSession(db: Db, id: string, userId: string): Promise<void> {
	await db
		.update(schema.bridgeSessions)
		.set({ status: "ended" })
		.where(
			and(
				eq(schema.bridgeSessions.id, id),
				eq(schema.bridgeSessions.userId, userId)
			)
		);
}

// Split touch/setAgentSessionId/end out into standalone functions above
// purely to keep this factory under the repo's max-lines-per-function gate.
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
		touch: (id) => touchSession(db, id),
		setAgentSessionId: (id, agentSessionId) =>
			setSessionAgentSessionId(db, id, agentSessionId),
		end: (id, userId) => endSession(db, id, userId),
	};
}
