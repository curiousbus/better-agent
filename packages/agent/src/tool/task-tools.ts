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

// A task can be referenced by its UUID `id` OR by its `seq` (the TASK-<seq>
// number the user sees). Resolve either to the concrete id.
async function resolveTaskId(
	store: TaskStore,
	userId: string,
	args: unknown
): Promise<string | null> {
	const record = args as Record<string, unknown>;
	if (typeof record.id === "string") {
		return record.id;
	}
	if (typeof record.seq === "number") {
		const task = await store.getBySeq(userId, record.seq);
		return task?.id ?? null;
	}
	return null;
}

const refSchema = { id: { type: "string" }, seq: { type: "number" } } as const;

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
	description:
		"Move a task (by id or seq) to a column/sprint and position. Pass status and position.",
	parameters: objectSchema(
		{
			...refSchema,
			status: statusSchema,
			position: { type: "number" },
			sprintId: { type: ["string", "null"] },
		},
		["status"]
	),
	execute: async (args) => {
		const id = await resolveTaskId(store, userId, args);
		if (!id) {
			return notFound();
		}
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
		const moved = await store.move(userId, id, patch);
		return moved ? ok(moved) : notFound();
	},
});

const updateTaskTool = (store: TaskStore, userId: string): ToolDef => ({
	name: "updateTask",
	description:
		"Update a task's title and/or description. Reference the task by id or seq (the TASK-<seq> number).",
	parameters: objectSchema(
		{
			...refSchema,
			title: { type: "string" },
			description: { type: "string" },
		},
		[]
	),
	execute: async (args) => {
		const id = await resolveTaskId(store, userId, args);
		if (!id) {
			return notFound();
		}
		const updated = await store.update(userId, id, {
			title: optionalString(args, "title"),
			description: optionalString(args, "description"),
		});
		return updated ? ok(updated) : notFound();
	},
});

const deleteTaskTool = (store: TaskStore, userId: string): ToolDef => ({
	name: "deleteTask",
	description: "Delete a task by id or seq (the TASK-<seq> number).",
	parameters: objectSchema({ ...refSchema }, []),
	execute: async (args) => {
		const id = await resolveTaskId(store, userId, args);
		if (!id) {
			return notFound();
		}
		const removed = await store.remove(userId, id);
		return removed ? ok({ ok: true }) : notFound();
	},
});

const getTaskTool = (store: TaskStore, userId: string): ToolDef => ({
	name: "getTask",
	description: "Get one task by id or seq (the TASK-<seq> number).",
	parameters: objectSchema({ ...refSchema }, []),
	execute: async (args) => {
		const id = await resolveTaskId(store, userId, args);
		if (!id) {
			return notFound();
		}
		const task = await store.get(userId, id);
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
