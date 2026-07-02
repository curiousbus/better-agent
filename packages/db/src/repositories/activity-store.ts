import { desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the whole schema namespace
import * as schema from "../schema";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const DEFAULT_LIMIT = 20;

export interface ActivityEvent {
	createdAt: Date;
	id: string;
	metadata: Record<string, unknown> | null;
	summary: string;
	type: string;
	userId: string;
}

export interface ActivityInput {
	metadata?: Record<string, unknown>;
	summary: string;
	type: string;
	userId: string;
}

export interface ActivityStore {
	listByUser(userId: string, limit?: number): Promise<ActivityEvent[]>;
	log(input: ActivityInput): Promise<void>;
}

export function createActivityStore(db: Db): ActivityStore {
	return {
		async log(input) {
			await db.insert(schema.activityEvents).values({
				userId: input.userId,
				type: input.type,
				summary: input.summary,
				metadata: input.metadata ?? null,
			});
		},
		async listByUser(userId, limit = DEFAULT_LIMIT) {
			const rows = await db
				.select()
				.from(schema.activityEvents)
				.where(eq(schema.activityEvents.userId, userId))
				.orderBy(desc(schema.activityEvents.createdAt))
				.limit(limit);
			return rows.map((row) => ({
				id: row.id,
				userId: row.userId,
				type: row.type,
				summary: row.summary,
				metadata: row.metadata ?? null,
				createdAt: row.createdAt,
			}));
		},
	};
}
