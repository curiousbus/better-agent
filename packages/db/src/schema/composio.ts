import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

// A composio account: the owner's own composio API key, named for humans.
// Toolkits are authenticated against this account (composio scopes connections
// by the account id), and the owner's agents link to accounts to gain tools.
export const composioAccounts = pgTable(
	"composio_accounts",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: text("name").notNull(),
		// Owner. Null for legacy admin-era accounts, which are not listed for any
		// web user (agents already linking them keep working).
		userId: uuid("user_id").references(() => users.id),
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
	},
	(table) => [index("composio_accounts_user_id_idx").on(table.userId)]
);
