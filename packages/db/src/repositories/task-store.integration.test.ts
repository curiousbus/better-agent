import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createTaskStore } from "./task-store";

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});
afterEach(async () => {
	await client.close();
});

it("create defaults to todo and increments position", async () => {
	const store = createTaskStore(db);
	const a = await store.create(USER_A, { title: "first" });
	const b = await store.create(USER_A, { title: "second" });
	expect(a.status).toBe("todo");
	expect(b.position).toBeGreaterThan(a.position);
});

it("listColumn returns only that user's column, sorted by position", async () => {
	const store = createTaskStore(db);
	await store.create(USER_A, { title: "todo-1" });
	const moved = await store.create(USER_A, { title: "doing-1" });
	await store.move(USER_A, moved.id, "in_progress", 1);
	await store.create(USER_B, { title: "other-user" });
	const todo = await store.listColumn(USER_A, "todo");
	const doing = await store.listColumn(USER_A, "in_progress");
	expect(todo.map((t) => t.title)).toEqual(["todo-1"]);
	expect(doing.map((t) => t.title)).toEqual(["doing-1"]);
});

it("a user cannot get/update/move/remove another user's task", async () => {
	const store = createTaskStore(db);
	const a = await store.create(USER_A, { title: "secret" });
	expect(await store.get(USER_B, a.id)).toBeNull();
	expect(await store.update(USER_B, a.id, { title: "hax" })).toBeNull();
	expect(await store.move(USER_B, a.id, "done", 1)).toBeNull();
	expect(await store.remove(USER_B, a.id)).toBe(false);
});

it("update patches description and remove deletes", async () => {
	const store = createTaskStore(db);
	const a = await store.create(USER_A, { title: "t" });
	const updated = await store.update(USER_A, a.id, { description: "details" });
	expect(updated?.description).toBe("details");
	expect(await store.remove(USER_A, a.id)).toBe(true);
	expect(await store.get(USER_A, a.id)).toBeNull();
});
