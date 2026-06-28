import {
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

// Uploaded attachments (images/files for a chat turn). Bytes live in object
// storage (R2); this table holds the metadata + the storage key, and links the
// attachment to the message it was sent with (message_id is null until then).
export const attachments = pgTable(
	"attachments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sessionId: uuid("session_id").notNull(),
		messageId: uuid("message_id"),
		r2Key: text("r2_key").notNull(),
		mime: text("mime").notNull(),
		name: text("name").notNull(),
		size: integer("size").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("attachments_message_id").on(table.messageId),
		index("attachments_session_id").on(table.sessionId),
	]
);
