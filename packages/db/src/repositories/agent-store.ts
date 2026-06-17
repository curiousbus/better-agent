import type { AgentStore } from "@better-agent/agent/ports";
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type AgentRow = typeof schema.agents.$inferSelect;

function toAgentConfig(row: AgentRow) {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		systemPrompt: row.systemPrompt,
		providerId: row.providerId,
		modelId: row.modelId,
		params: row.params ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function createAgentStore(db: Db): AgentStore {
	return {
		async create(input) {
			const rows = await db.insert(schema.agents).values(input).returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create agent");
			}
			return toAgentConfig(row);
		},
		async get(id) {
			const rows = await db
				.select()
				.from(schema.agents)
				.where(eq(schema.agents.id, id))
				.limit(1);
			const row = rows[0];
			return row ? toAgentConfig(row) : null;
		},
		async list() {
			const rows = await db.select().from(schema.agents);
			return rows.map(toAgentConfig);
		},
		async update(id, input) {
			const rows = await db
				.update(schema.agents)
				.set({ ...input, updatedAt: new Date() })
				.where(eq(schema.agents.id, id))
				.returning();
			const row = rows[0];
			return row ? toAgentConfig(row) : null;
		},
		async delete(id) {
			await db.delete(schema.agents).where(eq(schema.agents.id, id));
		},
	};
}
