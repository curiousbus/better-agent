import {
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// A per-user activity/timeline log: "signed in", "created agent X", etc. Shown
// on the user's dashboard and (later) in admin customer detail.
export const activityEvents = pgTable(
	"activity_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		type: text("type").notNull(),
		summary: text("summary").notNull(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("activity_events_user_created_idx").on(table.userId, table.createdAt),
	]
);
