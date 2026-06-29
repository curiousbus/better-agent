import type { ClientToolDef } from "@curiousbus/agent-client";

const TASKS = [
	{ id: 1, title: "Draft proposal", done: false },
	{ id: 2, title: "Review PR", done: true },
];
const ITEMS = ["Apples", "Bananas", "Cherries", "Dates"];

export const DATA_TOOLS: ClientToolDef[] = [
	{
		name: "listTasks",
		description: "List the current user's tasks.",
		parameters: { type: "object", properties: {} },
		execute: () => Promise.resolve(JSON.stringify(TASKS)),
	},
	{
		name: "getStats",
		description: "Get summary stats for the dashboard.",
		parameters: { type: "object", properties: {} },
		execute: () =>
			Promise.resolve(
				JSON.stringify({ open: 1, done: 1, total: TASKS.length })
			),
	},
	{
		name: "searchItems",
		description: "Search items by a query substring.",
		parameters: {
			type: "object",
			properties: { query: { type: "string" } },
			required: ["query"],
		},
		execute: (args) => {
			const query = String(
				(args as { query?: unknown }).query ?? ""
			).toLowerCase();
			return Promise.resolve(
				JSON.stringify(ITEMS.filter((i) => i.toLowerCase().includes(query)))
			);
		},
	},
];
