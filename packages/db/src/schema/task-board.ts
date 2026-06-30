import type { SprintStatus, TaskStatus } from "@better-agent/agent/task/types";
import {
	doublePrecision,
	index,
	integer,
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
		seq: integer("seq").notNull().default(0),
		sprintId: uuid("sprint_id"),
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
		index("tasks_user_sprint_status_position").on(
			table.userId,
			table.sprintId,
			table.status,
			table.position
		),
	]
);

export const sprints = pgTable(
	"sprints",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id").notNull(),
		name: text("name").notNull(),
		goal: text("goal").notNull().default(""),
		startDate: timestamp("start_date", { withTimezone: true }),
		endDate: timestamp("end_date", { withTimezone: true }),
		status: text("status").$type<SprintStatus>().notNull().default("future"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("sprints_user_id").on(table.userId),
		index("sprints_user_status").on(table.userId, table.status),
	]
);
