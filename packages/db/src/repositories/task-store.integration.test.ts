import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createTaskStore } from "./task-store";

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";
const SPRINT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});
afterEach(async () => {
	await client.close();
});

it("create assigns monotonic seq per user", async () => {
	const store = createTaskStore(db);
	const a = await store.create(USER_A, { title: "first" });
	const b = await store.create(USER_A, { title: "second" });
	expect(b.seq).toBeGreaterThan(a.seq);
});

it("each user starts its own seq from 1", async () => {
	const store = createTaskStore(db);
	const a = await store.create(USER_A, { title: "a task" });
	const b = await store.create(USER_B, { title: "b task" });
	expect(a.seq).toBe(1);
	expect(b.seq).toBe(1);
});

it("create into a sprint sets sprintId; no sprintId defaults to null", async () => {
	const store = createTaskStore(db);
	const inSprint = await store.create(USER_A, {
		title: "sprint task",
		sprintId: SPRINT_ID,
	});
	const backlog = await store.create(USER_A, { title: "backlog task" });
	expect(inSprint.sprintId).toBe(SPRINT_ID);
	expect(backlog.sprintId).toBeNull();
});

it("listColumn returns only matching sprint+status tasks", async () => {
	const store = createTaskStore(db);
	await store.create(USER_A, { title: "sprint-todo", sprintId: SPRINT_ID });
	await store.create(USER_A, { title: "backlog-todo" });
	await store.create(USER_A, {
		title: "sprint-done",
		sprintId: SPRINT_ID,
		status: "done",
	});

	const sprintTodos = await store.listColumn(USER_A, SPRINT_ID, "todo");
	expect(sprintTodos.map((t) => t.title)).toEqual(["sprint-todo"]);

	const backlogTodos = await store.listColumn(USER_A, null, "todo");
	expect(backlogTodos.map((t) => t.title)).toEqual(["backlog-todo"]);

	const sprintDone = await store.listColumn(USER_A, SPRINT_ID, "done");
	expect(sprintDone.map((t) => t.title)).toEqual(["sprint-done"]);
});

it("listBacklog returns only null-sprintId tasks", async () => {
	const store = createTaskStore(db);
	await store.create(USER_A, { title: "backlog-1" });
	await store.create(USER_A, { title: "backlog-2" });
	await store.create(USER_A, { title: "in-sprint", sprintId: SPRINT_ID });

	const backlog = await store.listBacklog(USER_A);
	expect(backlog.map((t) => t.title)).toEqual(["backlog-1", "backlog-2"]);
});

const MOVE_POSITION = 5;

it("move changes status, position, and sprintId when provided", async () => {
	const store = createTaskStore(db);
	const task = await store.create(USER_A, { title: "moveable" });
	const moved = await store.move(USER_A, task.id, {
		status: "in_progress",
		position: MOVE_POSITION,
		sprintId: SPRINT_ID,
	});
	expect(moved?.status).toBe("in_progress");
	expect(moved?.position).toBe(MOVE_POSITION);
	expect(moved?.sprintId).toBe(SPRINT_ID);
});

it("move WITHOUT sprintId in patch leaves sprintId unchanged", async () => {
	const store = createTaskStore(db);
	const task = await store.create(USER_A, {
		title: "sprint task",
		sprintId: SPRINT_ID,
	});
	const moved = await store.move(USER_A, task.id, {
		status: "done",
		position: 2,
	});
	expect(moved?.sprintId).toBe(SPRINT_ID);
});

it("cross-user isolation: USER_B cannot get/update/move/remove USER_A's task", async () => {
	const store = createTaskStore(db);
	const task = await store.create(USER_A, { title: "secret" });
	expect(await store.get(USER_B, task.id)).toBeNull();
	expect(await store.update(USER_B, task.id, { title: "hax" })).toBeNull();
	expect(
		await store.move(USER_B, task.id, { status: "done", position: 1 })
	).toBeNull();
	expect(await store.remove(USER_B, task.id)).toBe(false);
});

it("update patches title and description", async () => {
	const store = createTaskStore(db);
	const task = await store.create(USER_A, { title: "original" });
	const updated = await store.update(USER_A, task.id, {
		description: "details",
		title: "revised",
	});
	expect(updated?.title).toBe("revised");
	expect(updated?.description).toBe("details");
});

it("remove deletes the task", async () => {
	const store = createTaskStore(db);
	const task = await store.create(USER_A, { title: "to delete" });
	expect(await store.remove(USER_A, task.id)).toBe(true);
	expect(await store.get(USER_A, task.id)).toBeNull();
});
