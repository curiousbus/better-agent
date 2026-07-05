import { expect, it } from "vitest";
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
