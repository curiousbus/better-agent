import type { SessionStore } from "@better-agent/agent/ports";
import type { Session } from "@better-agent/agent/session/types";
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
type SessionRow = typeof schema.sessions.$inferSelect;

function toSession(row: SessionRow): Session {
	return {
		id: row.id,
		agentId: row.agentId,
		userId: row.userId,
		title: row.title,
		status: row.status,
		summary: row.summary,
		compactedThroughSeq: row.compactedThroughSeq,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function makeSessionMutators(
	db: Db
): Pick<SessionStore, "setStatus" | "setTitle" | "setSummary"> {
	return {
		async setStatus(id, status) {
			await db
				.update(schema.sessions)
				.set({ status, updatedAt: new Date() })
				.where(eq(schema.sessions.id, id));
		},
		async setTitle(id, title) {
			await db
				.update(schema.sessions)
				.set({ title, updatedAt: new Date() })
				.where(eq(schema.sessions.id, id));
		},
		async setSummary(id, summary, compactedThroughSeq) {
			await db
				.update(schema.sessions)
				.set({ summary, compactedThroughSeq, updatedAt: new Date() })
				.where(eq(schema.sessions.id, id));
		},
	};
}

export function createSessionStore(db: Db): SessionStore {
	return {
		async create(input) {
			const rows = await db
				.insert(schema.sessions)
				.values({ agentId: input.agentId, userId: input.userId ?? null })
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create session");
			}
			return toSession(row);
		},
		async get(id) {
			const rows = await db
				.select()
				.from(schema.sessions)
				.where(eq(schema.sessions.id, id))
				.limit(1);
			const row = rows[0];
			return row ? toSession(row) : null;
		},
		async list() {
			const rows = await db.select().from(schema.sessions);
			return rows.map(toSession);
		},
		async listByAgent(agentId) {
			const rows = await db
				.select()
				.from(schema.sessions)
				.where(eq(schema.sessions.agentId, agentId));
			return rows.map(toSession);
		},
		async listByUser(userId) {
			const rows = await db
				.select()
				.from(schema.sessions)
				.where(eq(schema.sessions.userId, userId));
			return rows.map(toSession);
		},
		...makeSessionMutators(db),
	};
}
