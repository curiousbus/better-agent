import type { AgentParams } from "@better-agent/agent/agent/types";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const agents = pgTable("agents", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	description: text("description").notNull(),
	systemPrompt: text("system_prompt").notNull(),
	providerId: text("provider_id").notNull(),
	modelId: text("model_id").notNull(),
	params: jsonb("params").$type<AgentParams>(),
	composioToolkits: jsonb("composio_toolkits")
		.$type<string[]>()
		.notNull()
		.default([]),
	tokenHash: text("token_hash").notNull().unique(),
	// The current token, encrypted (secret-box). Lets the admin reuse it for
	// chat instead of relying on a show-once copy. Null for backfilled agents.
	tokenCipher: text("token_cipher"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
