import type { ModelCapabilities } from "@better-agent/agent/provider/types";
import {
	boolean,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const providersCatalog = pgTable("providers_catalog", {
	providerId: text("provider_id").primaryKey(),
	name: text("name").notNull(),
	npm: text("npm"),
	defaultBaseURL: text("default_base_url"),
	envKeys: jsonb("env_keys").$type<string[]>().notNull().default([]),
	lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const modelsCache = pgTable(
	"models_cache",
	{
		providerId: text("provider_id").notNull(),
		modelId: text("model_id").notNull(),
		name: text("name").notNull(),
		contextLimit: integer("context_limit"),
		maxOutputTokens: integer("max_output_tokens"),
		inputPricePerM: real("input_price_per_m"),
		outputPricePerM: real("output_price_per_m"),
		capabilities: jsonb("capabilities").$type<ModelCapabilities>().notNull(),
		lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.providerId, table.modelId] })]
);

export const providerCredentials = pgTable("provider_credentials", {
	providerId: text("provider_id").primaryKey(),
	apiKeyCipher: text("api_key_cipher").notNull(),
	baseURL: text("base_url"),
	enabled: boolean("enabled").notNull().default(true),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
