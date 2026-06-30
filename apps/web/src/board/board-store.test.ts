import { describe, expect, it } from "vitest";
import {
	type BoardTask,
	createBoardStore,
	groupByColumn,
	midpoint,
	nextPosition,
	sortByPosition,
} from "./board-store";

const task = (over: Partial<BoardTask>): BoardTask => ({
	id: "t",
	title: "t",
	description: "",
	status: "todo",
	position: 1,
	seq: 0,
	sprintId: null,
	...over,
});

describe("pure helpers", () => {
	it("sortByPosition orders ascending", () => {
		const out = sortByPosition([
			task({ id: "b", position: 2 }),
			task({ id: "a", position: 1 }),
		]);
		expect(out.map((t) => t.id)).toEqual(["a", "b"]);
	});

	it("groupByColumn buckets and sorts", () => {
		const groups = groupByColumn([
			task({ id: "d", status: "done", position: 1 }),
			task({ id: "a", status: "todo", position: 2 }),
			task({ id: "b", status: "todo", position: 1 }),
		]);
		expect(groups.todo.map((t) => t.id)).toEqual(["b", "a"]);
		expect(groups.done.map((t) => t.id)).toEqual(["d"]);
	});

	it("midpoint returns a value strictly between neighbors", () => {
		const mid = midpoint(task({ position: 1 }), task({ position: 2 }));
		expect(mid).toBeGreaterThan(1);
		expect(mid).toBeLessThan(2);
	});

	it("nextPosition is greater than the column max", () => {
		expect(nextPosition([task({ position: 3 })])).toBeGreaterThan(3);
	});
});

describe("createBoardStore", () => {
	it("setColumn replaces only that column and notifies", () => {
		const store = createBoardStore();
		let ticks = 0;
		store.subscribe(() => {
			ticks += 1;
		});
		store.setColumn("todo", [task({ id: "x", status: "todo" })]);
		store.setColumn("done", [task({ id: "y", status: "done" })]);
		expect(
			store
				.getSnapshot()
				.map((t) => t.id)
				.sort()
		).toEqual(["x", "y"]);
		expect(ticks).toBe(2);
	});

	it("applyMove changes status/position; removeLocal drops it", () => {
		const store = createBoardStore();
		store.setColumn("todo", [task({ id: "x" })]);
		store.applyMove("x", "done", 5);
		expect(store.getSnapshot()[0]).toMatchObject({
			status: "done",
			position: 5,
		});
		store.removeLocal("x");
		expect(store.getSnapshot()).toHaveLength(0);
	});
});
