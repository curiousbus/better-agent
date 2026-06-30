import type { SprintStore } from "@better-agent/agent/ports";
import type { Sprint, SprintStatus } from "@better-agent/agent/task/types";
import { and, desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
type SprintRow = typeof schema.sprints.$inferSelect;

function toSprint(row: SprintRow): Sprint {
	return {
		id: row.id,
		userId: row.userId,
		name: row.name,
		goal: row.goal,
		startDate: row.startDate ? row.startDate.toISOString() : null,
		endDate: row.endDate ? row.endDate.toISOString() : null,
		status: row.status,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

const owned = (userId: string, id: string) =>
	and(eq(schema.sprints.id, id), eq(schema.sprints.userId, userId));

function makeSprintReaders(
	db: Db
): Pick<SprintStore, "list" | "get" | "active"> {
	return {
		async list(userId) {
			const rows = await db
				.select()
				.from(schema.sprints)
				.where(eq(schema.sprints.userId, userId))
				.orderBy(desc(schema.sprints.createdAt));
			return rows.map(toSprint);
		},
		async get(userId, id) {
			const rows = await db
				.select()
				.from(schema.sprints)
				.where(owned(userId, id))
				.limit(1);
			return rows[0] ? toSprint(rows[0]) : null;
		},
		async active(userId) {
			const rows = await db
				.select()
				.from(schema.sprints)
				.where(
					and(
						eq(schema.sprints.userId, userId),
						eq(schema.sprints.status, "active")
					)
				)
				.limit(1);
			return rows[0] ? toSprint(rows[0]) : null;
		},
	};
}

interface SprintUpdateSet {
	endDate?: Date | null;
	goal?: string;
	name?: string;
	startDate?: Date | null;
	updatedAt: Date;
}

interface SprintCreateInput {
	endDate?: string | null;
	goal?: string;
	name: string;
	startDate?: string | null;
}

async function insertSprint(
	db: Db,
	userId: string,
	input: SprintCreateInput
): Promise<Sprint> {
	const rows = await db
		.insert(schema.sprints)
		.values({
			userId,
			name: input.name,
			goal: input.goal ?? "",
			startDate: input.startDate ? new Date(input.startDate) : null,
			endDate: input.endDate ? new Date(input.endDate) : null,
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new Error("Failed to create sprint");
	}
	return toSprint(row);
}

function buildUpdateSet(patch: {
	endDate?: string | null;
	goal?: string;
	name?: string;
	startDate?: string | null;
}): SprintUpdateSet {
	const set: SprintUpdateSet = { updatedAt: new Date() };
	if (patch.name !== undefined) {
		set.name = patch.name;
	}
	if (patch.goal !== undefined) {
		set.goal = patch.goal;
	}
	if ("startDate" in patch) {
		set.startDate = patch.startDate ? new Date(patch.startDate) : null;
	}
	if ("endDate" in patch) {
		set.endDate = patch.endDate ? new Date(patch.endDate) : null;
	}
	return set;
}

function makeSprintWriters(
	db: Db
): Pick<SprintStore, "create" | "update" | "setStatus" | "remove"> {
	return {
		create: (userId, input) => insertSprint(db, userId, input),
		async update(userId, id, patch) {
			const rows = await db
				.update(schema.sprints)
				.set(buildUpdateSet(patch))
				.where(owned(userId, id))
				.returning();
			return rows[0] ? toSprint(rows[0]) : null;
		},
		async setStatus(userId, id, status: SprintStatus) {
			const rows = await db
				.update(schema.sprints)
				.set({ status, updatedAt: new Date() })
				.where(owned(userId, id))
				.returning();
			return rows[0] ? toSprint(rows[0]) : null;
		},
		async remove(userId, id) {
			const rows = await db
				.delete(schema.sprints)
				.where(owned(userId, id))
				.returning();
			return rows.length > 0;
		},
	};
}

export function createSprintStore(db: Db): SprintStore {
	return {
		...makeSprintReaders(db),
		...makeSprintWriters(db),
	};
}
