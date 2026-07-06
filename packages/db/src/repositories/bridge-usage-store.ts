import type {
	BridgeAgentKindUsage,
	BridgeUsageStore,
} from "@better-agent/agent/bridge/usage-ports";
import type { BridgeAgentKind } from "@better-agent/agent/ports";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the whole schema namespace
import * as schema from "../schema";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// The persisted `turn_usage` status event the CLI's claude-code normalize
// layer emits: `detail.costUsd`/`detail.numTurns` are camelCase keys the CLI
// set, but the nested `detail.usage` object is RAW claude usage in snake_case
// (`input_tokens`, `output_tokens`, `cache_read_input_tokens`,
// `cache_creation_input_tokens`) — hence the mixed-case JSONB paths below.
const TURN_USAGE_STATUS = "turn_usage";

interface UsageRow {
	agent_kind: string;
	cache_creation_tokens: string | number | null;
	cache_read_tokens: string | number | null;
	cost_usd: string | number | null;
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

function toUsage(row: UsageRow): BridgeAgentKindUsage {
	return {
		agentKind: row.agent_kind as BridgeAgentKind,
		costUsd: num(row.cost_usd),
		inputTokens: num(row.input_tokens),
		outputTokens: num(row.output_tokens),
		cacheReadTokens: num(row.cache_read_tokens),
		cacheCreationTokens: num(row.cache_creation_tokens),
		turns: num(row.turns),
	};
}

/**
 * Per-agent-kind Local Agent usage: sums the owner's persisted `turn_usage`
 * events (bridge_messages) joined to their bridge_sessions, grouped by the
 * session's `agent_kind`. Kinds with no turn_usage event in the window simply
 * don't appear (the caller decides whether to zero-fill them).
 */
export function createBridgeUsageStore(db: Db): BridgeUsageStore {
	return {
		async usageByAgentKind(
			userId: string,
			since: Date
		): Promise<BridgeAgentKindUsage[]> {
			const event = schema.bridgeMessages.event;
			const result = await db.execute(sql`
				SELECT
					${schema.bridgeSessions.agentKind} AS agent_kind,
					COALESCE(SUM((${event}->'detail'->>'costUsd')::numeric), 0) AS cost_usd,
					COALESCE(SUM((${event}->'detail'->'usage'->>'input_tokens')::bigint), 0) AS input_tokens,
					COALESCE(SUM((${event}->'detail'->'usage'->>'output_tokens')::bigint), 0) AS output_tokens,
					COALESCE(SUM((${event}->'detail'->'usage'->>'cache_read_input_tokens')::bigint), 0) AS cache_read_tokens,
					COALESCE(SUM((${event}->'detail'->'usage'->>'cache_creation_input_tokens')::bigint), 0) AS cache_creation_tokens,
					COUNT(*) AS turns
				FROM ${schema.bridgeMessages}
				JOIN ${schema.bridgeSessions}
					ON ${schema.bridgeSessions.id} = ${schema.bridgeMessages.sessionId}
				WHERE ${schema.bridgeSessions.userId} = ${userId}
					AND ${event}->>'status' = ${TURN_USAGE_STATUS}
					AND ${schema.bridgeMessages.createdAt} >= ${since}
				GROUP BY ${schema.bridgeSessions.agentKind}
				ORDER BY ${schema.bridgeSessions.agentKind}
			`);
			return resultRows(result).map(toUsage);
		},
	};
}
