import { describe, expect, it } from "vitest";
import type { BoardTask } from "./board-store";
import { containerOf, resolveDrop } from "./drag-resolve";

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

const SPRINT = "sprint-1";
const POS_LOW = 10;
const POS_MID = 20;
const POS_HIGH = 30;

describe("containerOf", () => {
	it("returns 'backlog' when sprintId is null", () => {
		expect(containerOf(task({ sprintId: null }))).toBe("backlog");
	});

	it("returns the task status when sprintId is set", () => {
		expect(containerOf(task({ sprintId: SPRINT, status: "in_progress" }))).toBe(
			"in_progress"
		);
		expect(containerOf(task({ sprintId: SPRINT, status: "done" }))).toBe(
			"done"
		);
	});
});

describe("resolveDrop — null / column targets", () => {
	it("returns null for unknown overId", () => {
		const snapshot = [
			task({ id: "a", sprintId: SPRINT, status: "todo", position: 1 }),
		];
		expect(resolveDrop(snapshot, "a", "unknown-id", SPRINT)).toBeNull();
	});

	it("drop on an empty column (overId = status string) → correct sprintId/status/position", () => {
		const snapshot = [
			task({ id: "a", sprintId: SPRINT, status: "todo", position: 1 }),
		];
		const result = resolveDrop(snapshot, "a", "in_progress", SPRINT);
		expect(result).not.toBeNull();
		expect(result?.sprintId).toBe(SPRINT);
		expect(result?.status).toBe("in_progress");
		expect(typeof result?.position).toBe("number");
	});

	it("drop into 'backlog' → sprintId null, status 'todo'", () => {
		const snapshot = [
			task({
				id: "active",
				sprintId: SPRINT,
				status: "in_progress",
				position: 1,
			}),
		];
		const result = resolveDrop(snapshot, "active", "backlog", SPRINT);
		expect(result).not.toBeNull();
		expect(result?.sprintId).toBeNull();
		expect(result?.status).toBe("todo");
		expect(typeof result?.position).toBe("number");
	});

	it("drop on empty board column with null activeSprintId uses null sprintId", () => {
		const snapshot = [
			task({ id: "a", sprintId: null, status: "todo", position: 1 }),
		];
		const result = resolveDrop(snapshot, "a", "done", null);
		expect(result?.sprintId).toBeNull();
		expect(result?.status).toBe("done");
	});
});

describe("resolveDrop — cross-column card-over-card", () => {
	const inProgressSnapshot = () => [
		task({ id: "active", sprintId: SPRINT, status: "todo", position: 1 }),
		task({
			id: "b1",
			sprintId: SPRINT,
			status: "in_progress",
			position: POS_LOW,
		}),
		task({
			id: "b2",
			sprintId: SPRINT,
			status: "in_progress",
			position: POS_MID,
		}),
	];

	it("drop ON first card in another column → position above it", () => {
		const result = resolveDrop(inProgressSnapshot(), "active", "b1", SPRINT);
		expect(result).not.toBeNull();
		expect(result?.status).toBe("in_progress");
		expect(result?.sprintId).toBe(SPRINT);
		expect(result?.position).toBeLessThan(POS_LOW);
	});

	it("drop ON second card inserts strictly between neighbors", () => {
		const result = resolveDrop(inProgressSnapshot(), "active", "b2", SPRINT);
		expect(result).not.toBeNull();
		expect(result?.position).toBeGreaterThan(POS_LOW);
		expect(result?.position).toBeLessThan(POS_MID);
	});
});

describe("resolveDrop — same-column reorder", () => {
	it("drag within the same column to a new slot → correct position", () => {
		const snapshot = [
			task({ id: "a", sprintId: SPRINT, status: "todo", position: POS_LOW }),
			task({ id: "b", sprintId: SPRINT, status: "todo", position: POS_MID }),
			task({ id: "c", sprintId: SPRINT, status: "todo", position: POS_HIGH }),
		];
		// move 'a' over 'c' → should go after 'b' (between POS_MID and POS_HIGH)
		const result = resolveDrop(snapshot, "a", "c", SPRINT);
		expect(result).not.toBeNull();
		expect(result?.status).toBe("todo");
		expect(result?.sprintId).toBe(SPRINT);
		expect(result?.position).toBeGreaterThan(POS_MID);
		expect(result?.position).toBeLessThan(POS_HIGH);
	});
});
