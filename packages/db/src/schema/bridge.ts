import type {
	BridgeAgentKind,
	BridgeSessionStatus,
} from "@better-agent/agent/ports";
import {
	bigint,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// A long-lived credential the local bridge CLI uses to authenticate to the
// server on behalf of a user. Only the sha256 hash is ever stored — the raw
// `bt_`-prefixed token is shown once, at creation time.
export const bridgeTokens = pgTable(
	"bridge_tokens",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		name: text("name"),
		tokenHash: text("token_hash").notNull().unique(),
		last4: text("last4"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
	},
	(table) => [index("bridge_tokens_user_id_idx").on(table.userId)]
);

// A single local-agent run relayed through the bridge (one row per CLI
// session, spanning however many turns the local agent handles).
export const bridgeSessions = pgTable(
	"bridge_sessions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		tokenId: uuid("token_id")
			.notNull()
			.references(() => bridgeTokens.id),
		agentKind: text("agent_kind").$type<BridgeAgentKind>().notNull(),
		label: text("label"),
		status: text("status")
			.$type<BridgeSessionStatus>()
			.notNull()
			.default("active"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("bridge_sessions_user_id_idx").on(table.userId)]
);

// A single relayed bridge event, persisted so a Local Agent conversation
// survives a page reload — the relay store's window is Redis-only and TTLs
// out. `seq` mirrors the relay's own SERVER-assigned monotonic id (per
// session), so persisted history and the live feed share one ordering and
// the web can dedupe replayed-then-live events by id.
export const bridgeMessages = pgTable(
	"bridge_messages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sessionId: uuid("session_id")
			.notNull()
			.references(() => bridgeSessions.id),
		seq: bigint("seq", { mode: "number" }).notNull(),
		event: jsonb("event").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("bridge_messages_session_id_seq_idx").on(table.sessionId, table.seq),
	]
);
