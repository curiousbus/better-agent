import type { TaskStore } from "../ports";
import type { TaskStatus } from "../task/types";
import type { ExecuteResult, JsonSchema, ToolDef } from "./types";

const STATUS_VALUES: TaskStatus[] = ["todo", "in_progress", "done"];

const statusSchema = {
	type: "string",
	enum: STATUS_VALUES,
} as const;

const ok = (value: unknown): ExecuteResult => ({
	output: JSON.stringify(value),
});
const notFound = (): ExecuteResult => ({
	output: JSON.stringify({ error: "not_found" }),
	isError: true,
});

function asString(args: unknown, key: string): string {
	const value = (args as Record<string, unknown>)[key];
	if (typeof value !== "string") {
		throw new Error(`Missing string arg: ${key}`);
	}
	return value;
}

function optionalString(args: unknown, key: string): string | undefined {
	const value = (args as Record<string, unknown>)[key];
	return typeof value === "string" ? value : undefined;
}

function asStatus(value: unknown): TaskStatus {
	if (STATUS_VALUES.includes(value as TaskStatus)) {
		return value as TaskStatus;
	}
	throw new Error(`Invalid status: ${String(value)}`);
}

const objectSchema = (
	properties: JsonSchema,
	required: string[]
): JsonSchema => ({
	type: "object",
	properties,
	required,
	additionalProperties: false,
});

const listColumnTool = (store: TaskStore, userId: string): ToolDef => ({
	name: "listColumn",
	description:
		"List the current user's tasks in one column (status). Returns an array.",
	parameters: objectSchema({ status: statusSchema }, ["status"]),
	execute: async (args) =>
		ok(
			await store.listColumn(
				userId,
				asStatus((args as Record<string, unknown>).status)
			)
		),
});

const createTaskTool = (store: TaskStore, userId: string): ToolDef => ({
	name: "createTask",
	description:
		"Create a task for the current user. Defaults to the todo column.",
	parameters: objectSchema(
		{ title: { type: "string" }, status: statusSchema },
		["title"]
	),
	execute: async (args) => {
		const status = optionalString(args, "status");
		return ok(
			await store.create(userId, {
				title: asString(args, "title"),
				status: status ? asStatus(status) : undefined,
			})
		);
	},
});

const moveTaskTool = (store: TaskStore, userId: string): ToolDef => ({
	name: "moveTask",
	description: "Move a task to a column and position.",
	parameters: objectSchema(
		{
			id: { type: "string" },
			status: statusSchema,
			position: { type: "number" },
		},
		["id", "status", "position"]
	),
	execute: async (args) => {
		const record = args as Record<string, unknown>;
		const moved = await store.move(
			userId,
			asString(args, "id"),
			asStatus(record.status),
			typeof record.position === "number" ? record.position : 0
		);
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
		listColumnTool(store, userId),
		createTaskTool(store, userId),
		moveTaskTool(store, userId),
		updateTaskTool(store, userId),
		deleteTaskTool(store, userId),
		getTaskTool(store, userId),
	];
}
