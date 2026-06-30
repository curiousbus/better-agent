import type { TaskStore } from "@better-agent/agent/ports";
import type { Task, TaskStatus } from "@better-agent/agent/task/types";
import { and, asc, eq, isNull, max } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
type TaskRow = typeof schema.tasks.$inferSelect;

function toTask(row: TaskRow): Task {
	return {
		id: row.id,
		userId: row.userId,
		seq: row.seq,
		sprintId: row.sprintId,
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

const sprintFilter = (sprintId: string | null) =>
	sprintId === null
		? isNull(schema.tasks.sprintId)
		: eq(schema.tasks.sprintId, sprintId);

async function nextSeq(db: Db, userId: string): Promise<number> {
	const [row] = await db
		.select({ maxSeq: max(schema.tasks.seq) })
		.from(schema.tasks)
		.where(eq(schema.tasks.userId, userId));
	return (row?.maxSeq ?? 0) + 1;
}

async function nextPosition(
	db: Db,
	userId: string,
	status: TaskStatus,
	sprintId: string | null
): Promise<number> {
	const rows = await db
		.select()
		.from(schema.tasks)
		.where(
			and(
				eq(schema.tasks.userId, userId),
				eq(schema.tasks.status, status),
				sprintFilter(sprintId)
			)
		);
	const maxPos = rows.reduce((m, r) => Math.max(m, r.position), 0);
	return maxPos + 1;
}

function makeTaskReaders(
	db: Db
): Pick<TaskStore, "listColumn" | "listBacklog" | "get"> {
	return {
		async listColumn(userId, sprintId, status) {
			const rows = await db
				.select()
				.from(schema.tasks)
				.where(
					and(
						eq(schema.tasks.userId, userId),
						sprintFilter(sprintId),
						eq(schema.tasks.status, status)
					)
				)
				.orderBy(asc(schema.tasks.position));
			return rows.map(toTask);
		},
		async listBacklog(userId) {
			const rows = await db
				.select()
				.from(schema.tasks)
				.where(
					and(eq(schema.tasks.userId, userId), isNull(schema.tasks.sprintId))
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

async function createTask(
	db: Db,
	userId: string,
	input: { sprintId?: string | null; status?: TaskStatus; title: string }
): Promise<Task> {
	const status = input.status ?? "todo";
	const sprintId = input.sprintId ?? null;
	const seq = await nextSeq(db, userId);
	const position = await nextPosition(db, userId, status, sprintId);
	const rows = await db
		.insert(schema.tasks)
		.values({ userId, title: input.title, status, position, seq, sprintId })
		.returning();
	const row = rows[0];
	if (!row) {
		throw new Error("Failed to create task");
	}
	return toTask(row);
}

interface MoveSet {
	position: number;
	sprintId?: string | null;
	status: TaskStatus;
	updatedAt: Date;
}

function makeTaskWriters(
	db: Db
): Pick<TaskStore, "create" | "update" | "move" | "remove"> {
	return {
		create(userId, input) {
			return createTask(db, userId, input);
		},
		async update(userId, id, patch) {
			const rows = await db
				.update(schema.tasks)
				.set({ ...patch, updatedAt: new Date() })
				.where(owned(userId, id))
				.returning();
			return rows[0] ? toTask(rows[0]) : null;
		},
		async move(userId, id, patch) {
			const set: MoveSet = {
				status: patch.status,
				position: patch.position,
				updatedAt: new Date(),
			};
			if ("sprintId" in patch) {
				set.sprintId = patch.sprintId ?? null;
			}
			const rows = await db
				.update(schema.tasks)
				.set(set)
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
