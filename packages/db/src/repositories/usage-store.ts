import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the whole schema namespace
import * as schema from "../schema";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DailyUsage {
	costCents: number;
	day: string; // YYYY-MM-DD (UTC)
	inputTokens: number;
	outputTokens: number;
	turns: number;
}

export interface UsageStore {
	dailySummary(userId: string, since: Date): Promise<DailyUsage[]>;
}

interface UsageRow {
	cost_cents: string | number | null;
	day: string;
	input_tokens: string | number | null;
	output_tokens: string | number | null;
	turns: string | number | null;
}

// db.execute returns `{ rows }` on node-postgres and an array on some drivers.
function resultRows(result: unknown): UsageRow[] {
	if (Array.isArray(result)) {
		return result as UsageRow[];
	}
	return ((result as { rows?: UsageRow[] }).rows ?? []) as UsageRow[];
}

const num = (value: string | number | null): number => Number(value ?? 0);

/**
 * Per-user token usage aggregated from assistant messages (messages.usage),
 * joined to sessions for the owner. One row per UTC day since `since`.
 */
export function createUsageStore(db: Db): UsageStore {
	return {
		async dailySummary(userId: string, since: Date): Promise<DailyUsage[]> {
			const result = await db.execute(sql`
				SELECT
					to_char(date_trunc('day', ${schema.messages.createdAt}), 'YYYY-MM-DD') AS day,
					COALESCE(SUM((${schema.messages.usage}->>'inputTokens')::bigint), 0) AS input_tokens,
					COALESCE(SUM((${schema.messages.usage}->>'outputTokens')::bigint), 0) AS output_tokens,
					COALESCE(SUM((${schema.messages.usage}->>'costCents')::numeric), 0) AS cost_cents,
					COUNT(*) AS turns
				FROM ${schema.messages}
				JOIN ${schema.sessions} ON ${schema.sessions.id} = ${schema.messages.sessionId}
				WHERE ${schema.sessions.userId} = ${userId}
					AND ${schema.messages.role} = 'assistant'
					AND ${schema.messages.createdAt} >= ${since}
					AND ${schema.messages.usage} IS NOT NULL
				GROUP BY 1
				ORDER BY 1
			`);
			return resultRows(result).map((row) => ({
				day: row.day,
				inputTokens: num(row.input_tokens),
				outputTokens: num(row.output_tokens),
				costCents: num(row.cost_cents),
				turns: num(row.turns),
			}));
		},
	};
}
