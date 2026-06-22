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
	tokenHash: text("token_hash").notNull().unique(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
