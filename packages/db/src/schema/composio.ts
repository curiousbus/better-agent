import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// An admin-managed composio account: one composio API key the admin owns, named
// for humans. Toolkits are authenticated against this account (composio scopes
// connections by the account id), and agents link to accounts to gain tools.
export const composioAccounts = pgTable("composio_accounts", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	// The composio API key, encrypted at rest (secret-box). Never returned to
	// clients — only `apiKeyLast4` is shown, masked.
	apiKeyCipher: text("api_key_cipher").notNull(),
	apiKeyLast4: text("api_key_last4").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
