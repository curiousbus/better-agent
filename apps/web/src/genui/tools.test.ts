import { expect, it, vi } from "vitest";
import { routeAction } from "./handlers";
import { DATA_TOOLS } from "./tools";

it("addTodo then listTodos round-trips through the store", async () => {
	const add = DATA_TOOLS.find((t) => t.name === "addTodo");
	const list = DATA_TOOLS.find((t) => t.name === "listTodos");
	await add?.execute({ title: "write tests" });
	const out = JSON.parse((await list?.execute({})) ?? "null") as {
		title: string;
	}[];
	expect(Array.isArray(out)).toBe(true);
	expect(out.some((t) => t.title === "write tests")).toBe(true);
});

it("routeAction sends to handler or agent by target", () => {
	const handler = vi.fn();
	const send = vi.fn();
	routeAction(
		{ intent: "press", target: "client", payload: 1 },
		{ handlers: { press: handler }, sendAgentEvent: send }
	);
	expect(handler).toHaveBeenCalledWith(1);
	routeAction(
		{ intent: "submit", target: "agent" },
		{ handlers: {}, sendAgentEvent: send }
	);
	expect(send).toHaveBeenCalled();
});
