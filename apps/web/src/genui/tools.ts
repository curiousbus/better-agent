import type { ClientToolDef } from "@curiousbus/agent-client";
import { addTodo, getTodos, removeTodo, toggleTodo } from "./todo-store";

function arg(args: unknown, key: string): string {
	return String((args as Record<string, unknown>)[key] ?? "");
}

/** Client tools the agent can call to manage todos. They mutate the SAME store
 * the TodoList widget reads, so conversational edits show up live in the UI. */
export const DATA_TOOLS: ClientToolDef[] = [
	{
		name: "listTodos",
		description:
			"List the user's todo items (each has an id, title, and done flag).",
		parameters: { type: "object", properties: {} },
		execute: () => Promise.resolve(JSON.stringify(getTodos())),
	},
	{
		name: "addTodo",
		description: "Add a new todo with the given title.",
		parameters: {
			type: "object",
			properties: { title: { type: "string" } },
			required: ["title"],
		},
		execute: (args) =>
			Promise.resolve(JSON.stringify(addTodo(arg(args, "title")))),
	},
	{
		name: "toggleTodo",
		description: "Toggle a todo's done state by its id.",
		parameters: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
		},
		execute: (args) =>
			Promise.resolve(JSON.stringify(toggleTodo(arg(args, "id")))),
	},
	{
		name: "removeTodo",
		description: "Delete a todo by its id.",
		parameters: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
		},
		execute: (args) =>
			Promise.resolve(JSON.stringify(removeTodo(arg(args, "id")))),
	},
];
