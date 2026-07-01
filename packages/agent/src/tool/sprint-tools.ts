import type { SprintStore } from "../ports";
import {
	asString,
	notFound,
	objectSchema,
	ok,
	optionalString,
} from "./task-tools";
import type { ToolDef } from "./types";

const listSprintsTool = (store: SprintStore, userId: string): ToolDef => ({
	name: "listSprints",
	description: "List all sprints for the current user.",
	parameters: objectSchema({}, []),
	execute: async () => ok(await store.list(userId)),
});

const activeSprintTool = (store: SprintStore, userId: string): ToolDef => ({
	name: "activeSprint",
	description: "Get the current user's active sprint, or null if none.",
	parameters: objectSchema({}, []),
	execute: async () => ok(await store.active(userId)),
});

const createSprintTool = (store: SprintStore, userId: string): ToolDef => ({
	name: "createSprint",
	description: "Create a new sprint.",
	parameters: objectSchema(
		{
			name: { type: "string" },
			goal: { type: "string" },
			startDate: { type: ["string", "null"] },
			endDate: { type: ["string", "null"] },
		},
		["name"]
	),
	execute: async (args) => {
		const record = args as Record<string, unknown>;
		const startDate =
			typeof record.startDate === "string" ? record.startDate : null;
		const endDate = typeof record.endDate === "string" ? record.endDate : null;
		return ok(
			await store.create(userId, {
				name: asString(args, "name"),
				goal: optionalString(args, "goal"),
				startDate,
				endDate,
			})
		);
	},
});

const getSprintTool = (store: SprintStore, userId: string): ToolDef => ({
	name: "getSprint",
	description: "Get one sprint by id.",
	parameters: objectSchema({ id: { type: "string" } }, ["id"]),
	execute: async (args) => {
		const sprint = await store.get(userId, asString(args, "id"));
		return sprint ? ok(sprint) : notFound();
	},
});

const updateSprintTool = (store: SprintStore, userId: string): ToolDef => ({
	name: "updateSprint",
	description: "Update a sprint's name, goal, or dates.",
	parameters: objectSchema(
		{
			id: { type: "string" },
			name: { type: "string" },
			goal: { type: "string" },
			startDate: { type: ["string", "null"] },
			endDate: { type: ["string", "null"] },
		},
		["id"]
	),
	execute: async (args) => {
		const record = args as Record<string, unknown>;
		const patch: {
			name?: string;
			goal?: string;
			startDate?: string | null;
			endDate?: string | null;
		} = {
			name: optionalString(args, "name"),
			goal: optionalString(args, "goal"),
		};
		if ("startDate" in (args as object)) {
			patch.startDate =
				typeof record.startDate === "string" ? record.startDate : null;
		}
		if ("endDate" in (args as object)) {
			patch.endDate =
				typeof record.endDate === "string" ? record.endDate : null;
		}
		const updated = await store.update(userId, asString(args, "id"), patch);
		return updated ? ok(updated) : notFound();
	},
});

const startSprintTool = (store: SprintStore, userId: string): ToolDef => ({
	name: "startSprint",
	description:
		"Set a sprint to active status. Fails if a different sprint is already active.",
	parameters: objectSchema({ id: { type: "string" } }, ["id"]),
	execute: async (args) => {
		const id = asString(args, "id");
		const cur = await store.active(userId);
		if (cur && cur.id !== id) {
			return {
				output: JSON.stringify({ error: "already_active" }),
				isError: true,
			};
		}
		const s = await store.setStatus(userId, id, "active");
		return s ? ok(s) : notFound();
	},
});

const completeSprintTool = (store: SprintStore, userId: string): ToolDef => ({
	name: "completeSprint",
	description: "Mark a sprint as completed.",
	parameters: objectSchema({ id: { type: "string" } }, ["id"]),
	execute: async (args) => {
		const s = await store.setStatus(userId, asString(args, "id"), "completed");
		return s ? ok(s) : notFound();
	},
});

const deleteSprintTool = (store: SprintStore, userId: string): ToolDef => ({
	name: "deleteSprint",
	description: "Delete a sprint.",
	parameters: objectSchema({ id: { type: "string" } }, ["id"]),
	execute: async (args) => {
		const removed = await store.remove(userId, asString(args, "id"));
		return removed ? ok({ ok: true }) : notFound();
	},
});

export function buildSprintToolDefs(
	store: SprintStore,
	userId: string
): ToolDef[] {
	return [
		listSprintsTool(store, userId),
		activeSprintTool(store, userId),
		createSprintTool(store, userId),
		getSprintTool(store, userId),
		updateSprintTool(store, userId),
		startSprintTool(store, userId),
		completeSprintTool(store, userId),
		deleteSprintTool(store, userId),
	];
}
