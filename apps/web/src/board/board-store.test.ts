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

describe("createBoardStore setColumn / setBacklog", () => {
	it("setColumn preserves backlog and other sprint columns", () => {
		const store = createBoardStore();
		let ticks = 0;
		store.subscribe(() => {
			ticks += 1;
		});
		const sprintId = "sprint-1";
		store.setBacklog([
			task({ id: "backlog-1", sprintId: null, status: "todo" }),
		]);
		store.setColumn("todo", [task({ id: "x", status: "todo", sprintId })]);
		store.setColumn("done", [task({ id: "y", status: "done", sprintId })]);
		expect(
			store
				.getSnapshot()
				.map((t) => t.id)
				.sort()
		).toEqual(["backlog-1", "x", "y"]);
		store.setColumn("todo", [task({ id: "x2", status: "todo", sprintId })]);
		expect(
			store
				.getSnapshot()
				.map((t) => t.id)
				.sort()
		).toEqual(["backlog-1", "x2", "y"]);
		expect(ticks).toBe(4);
	});

	it("setBacklog replaces all backlog tasks, preserving sprint tasks", () => {
		const store = createBoardStore();
		const sprintId = "sprint-1";
		store.setColumn("todo", [
			task({ id: "sprint-task", status: "todo", sprintId }),
		]);
		store.setBacklog([task({ id: "b1", sprintId: null, status: "todo" })]);
		expect(
			store
				.getSnapshot()
				.map((t) => t.id)
				.sort()
		).toEqual(["b1", "sprint-task"]);
		store.setBacklog([task({ id: "b2", sprintId: null, status: "todo" })]);
		expect(
			store
				.getSnapshot()
				.map((t) => t.id)
				.sort()
		).toEqual(["b2", "sprint-task"]);
	});
});

describe("createBoardStore applyMove / removeLocal", () => {
	it("applyMove changes status/position; removeLocal drops it", () => {
		const store = createBoardStore();
		store.setColumn("todo", [task({ id: "x", sprintId: "sprint-1" })]);
		store.applyMove("x", { sprintId: null, status: "done", position: 5 });
		expect(store.getSnapshot()[0]).toMatchObject({
			status: "done",
			position: 5,
		});
		store.removeLocal("x");
		expect(store.getSnapshot()).toHaveLength(0);
	});
});
