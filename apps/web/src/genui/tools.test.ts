import { expect, it, vi } from "vitest";
import { routeAction } from "./handlers";
import { DATA_TOOLS } from "./tools";

it("listTasks returns parseable JSON array", async () => {
	const tool = DATA_TOOLS.find((t) => t.name === "listTasks");
	const out = JSON.parse((await tool?.execute({})) ?? "null");
	expect(Array.isArray(out)).toBe(true);
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
