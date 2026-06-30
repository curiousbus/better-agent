import type { TaskStore } from "@better-agent/agent/ports";
import type { Task, TaskStatus } from "@better-agent/agent/task/types";
import { and, asc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
type TaskRow = typeof schema.tasks.$inferSelect;

function toTask(row: TaskRow): Task {
	return {
		id: row.id,
		userId: row.userId,
		title: row.title,
		description: row.description,
		status: row.status,
		position: row.position,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

const owned = (userId: string, id: string) =>
	and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId));

async function nextPosition(
	db: Db,
	userId: string,
	status: TaskStatus
): Promise<number> {
	const rows = await db
		.select()
		.from(schema.tasks)
		.where(
			and(eq(schema.tasks.userId, userId), eq(schema.tasks.status, status))
		);
	const max = rows.reduce((m, r) => Math.max(m, r.position), 0);
	return max + 1;
}

function makeTaskReaders(
	db: Db
): Pick<TaskStore, "list" | "listColumn" | "get"> {
	return {
		async list(userId) {
			const rows = await db
				.select()
				.from(schema.tasks)
				.where(eq(schema.tasks.userId, userId))
				.orderBy(asc(schema.tasks.position));
			return rows.map(toTask);
		},
		async listColumn(userId, status) {
			const rows = await db
				.select()
				.from(schema.tasks)
				.where(
					and(eq(schema.tasks.userId, userId), eq(schema.tasks.status, status))
				)
				.orderBy(asc(schema.tasks.position));
			return rows.map(toTask);
		},
		async get(userId, id) {
			const rows = await db
				.select()
				.from(schema.tasks)
				.where(owned(userId, id))
				.limit(1);
			return rows[0] ? toTask(rows[0]) : null;
		},
	};
}

function makeTaskWriters(
	db: Db
): Pick<TaskStore, "create" | "update" | "move" | "remove"> {
	return {
		async create(userId, input) {
			const status = input.status ?? "todo";
			const position = await nextPosition(db, userId, status);
			const rows = await db
				.insert(schema.tasks)
				.values({ userId, title: input.title, status, position })
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create task");
			}
			return toTask(row);
		},
		async update(userId, id, patch) {
			const rows = await db
				.update(schema.tasks)
				.set({ ...patch, updatedAt: new Date() })
				.where(owned(userId, id))
				.returning();
			return rows[0] ? toTask(rows[0]) : null;
		},
		async move(userId, id, status, position) {
			const rows = await db
				.update(schema.tasks)
				.set({ status, position, updatedAt: new Date() })
				.where(owned(userId, id))
				.returning();
			return rows[0] ? toTask(rows[0]) : null;
		},
		async remove(userId, id) {
			const rows = await db
				.delete(schema.tasks)
				.where(owned(userId, id))
				.returning();
			return rows.length > 0;
		},
	};
}

export function createTaskStore(db: Db): TaskStore {
	return {
		...makeTaskReaders(db),
		...makeTaskWriters(db),
	};
}
