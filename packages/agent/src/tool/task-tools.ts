import type { TaskStore } from "../ports";
import type { TaskStatus } from "../task/types";
import type { ExecuteResult, JsonSchema, ToolDef } from "./types";

export const STATUS_VALUES: TaskStatus[] = ["todo", "in_progress", "done"];

export const statusSchema = {
	type: "string",
	enum: STATUS_VALUES,
} as const;

export const ok = (value: unknown): ExecuteResult => ({
	output: JSON.stringify(value),
});

export const notFound = (): ExecuteResult => ({
	output: JSON.stringify({ error: "not_found" }),
	isError: true,
});

export function asString(args: unknown, key: string): string {
	const value = (args as Record<string, unknown>)[key];
	if (typeof value !== "string") {
		throw new Error(`Missing string arg: ${key}`);
	}
	return value;
}

export function optionalString(args: unknown, key: string): string | undefined {
	const value = (args as Record<string, unknown>)[key];
	return typeof value === "string" ? value : undefined;
}

export function asStatus(value: unknown): TaskStatus {
	if (STATUS_VALUES.includes(value as TaskStatus)) {
		return value as TaskStatus;
	}
	throw new Error(`Invalid status: ${String(value)}`);
}

export const objectSchema = (
	properties: JsonSchema,
	required: string[]
): JsonSchema => ({
	type: "object",
	properties,
	required,
	additionalProperties: false,
});

const listSprintColumnTool = (store: TaskStore, userId: string): ToolDef => ({
	name: "listSprintColumn",
	description:
		"List tasks in a sprint column (sprintId + status). Pass null sprintId for backlog column.",
	parameters: objectSchema(
		{
			sprintId: { type: ["string", "null"] },
			status: statusSchema,
		},
		["sprintId", "status"]
	),
	execute: async (args) => {
		const record = args as Record<string, unknown>;
		const sprintId =
			typeof record.sprintId === "string" ? record.sprintId : null;
		return ok(
			await store.listColumn(userId, sprintId, asStatus(record.status))
		);
	},
});

const listBacklogTool = (store: TaskStore, userId: string): ToolDef => ({
	name: "listBacklog",
	description: "List all backlog tasks (not assigned to any sprint).",
	parameters: objectSchema({}, []),
	execute: async () => ok(await store.listBacklog(userId)),
});

const createTaskTool = (store: TaskStore, userId: string): ToolDef => ({
	name: "createTask",
	description:
		"Create a task for the current user. Defaults to the todo column.",
	parameters: objectSchema(
		{
			title: { type: "string" },
			status: statusSchema,
			sprintId: { type: ["string", "null"] },
		},
		["title"]
	),
	execute: async (args) => {
		const status = optionalString(args, "status");
		const record = args as Record<string, unknown>;
		const sprintId =
			typeof record.sprintId === "string" ? record.sprintId : undefined;
		return ok(
			await store.create(userId, {
				title: asString(args, "title"),
				status: status ? asStatus(status) : undefined,
				sprintId,
			})
		);
	},
});

const moveTaskTool = (store: TaskStore, userId: string): ToolDef => ({
	name: "moveTask",
	description: "Move a task to a column/sprint and position.",
	parameters: objectSchema(
		{
			id: { type: "string" },
			status: statusSchema,
			position: { type: "number" },
			sprintId: { type: ["string", "null"] },
		},
		["id", "status", "position"]
	),
	execute: async (args) => {
		const record = args as Record<string, unknown>;
		const patch: {
			position: number;
			sprintId?: string | null;
			status: TaskStatus;
		} = {
			status: asStatus(record.status),
			position: typeof record.position === "number" ? record.position : 0,
		};
		if ("sprintId" in (args as object)) {
			patch.sprintId =
				typeof record.sprintId === "string" ? record.sprintId : null;
		}
		const moved = await store.move(userId, asString(args, "id"), patch);
		return moved ? ok(moved) : notFound();
	},
});

const updateTaskTool = (store: TaskStore, userId: string): ToolDef => ({
	name: "updateTask",
	description: "Update a task's title and/or description.",
	parameters: objectSchema(
		{
			id: { type: "string" },
			title: { type: "string" },
			description: { type: "string" },
		},
		["id"]
	),
	execute: async (args) => {
		const updated = await store.update(userId, asString(args, "id"), {
			title: optionalString(args, "title"),
			description: optionalString(args, "description"),
		});
		return updated ? ok(updated) : notFound();
	},
});

const deleteTaskTool = (store: TaskStore, userId: string): ToolDef => ({
	name: "deleteTask",
	description: "Delete a task.",
	parameters: objectSchema({ id: { type: "string" } }, ["id"]),
	execute: async (args) => {
		const removed = await store.remove(userId, asString(args, "id"));
		return removed ? ok({ ok: true }) : notFound();
	},
});

const getTaskTool = (store: TaskStore, userId: string): ToolDef => ({
	name: "getTask",
	description: "Get one task by id.",
	parameters: objectSchema({ id: { type: "string" } }, ["id"]),
	execute: async (args) => {
		const task = await store.get(userId, asString(args, "id"));
		return task ? ok(task) : notFound();
	},
});

export function buildTaskToolDefs(store: TaskStore, userId: string): ToolDef[] {
	return [
		listSprintColumnTool(store, userId),
		listBacklogTool(store, userId),
		createTaskTool(store, userId),
		moveTaskTool(store, userId),
		updateTaskTool(store, userId),
		deleteTaskTool(store, userId),
		getTaskTool(store, userId),
	];
}
