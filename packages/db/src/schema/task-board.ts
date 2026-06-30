import type { TaskStatus } from "@better-agent/agent/task/types";
import {
	doublePrecision,
	index,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

export const tasks = pgTable(
	"tasks",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id").notNull(),
		title: text("title").notNull(),
		description: text("description").notNull().default(""),
		status: text("status").$type<TaskStatus>().notNull().default("todo"),
		position: doublePrecision("position").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("tasks_user_id").on(table.userId),
		index("tasks_user_status_position").on(
			table.userId,
			table.status,
			table.position
		),
	]
);
