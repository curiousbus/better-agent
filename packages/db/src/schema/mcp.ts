import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

// A user-registered remote MCP server (e.g. X's hosted MCP at api.x.com/mcp).
// The owner's agents link servers by id and gain their tools each turn.
export const mcpServers = pgTable(
	"mcp_servers",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		name: text("name").notNull(),
		url: text("url").notNull(),
		// Full Authorization header value ("Bearer …"), encrypted at rest
		// (secret-box). Null for servers that need no auth (e.g. docs.x.com/mcp).
		// Never returned to clients — only authLast4 is shown, masked.
		authHeaderCipher: text("auth_header_cipher"),
		authLast4: text("auth_last4"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("mcp_servers_user_id_idx").on(table.userId)]
);
