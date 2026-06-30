import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createSprintStore } from "./sprint-store";

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

it("create returns a future sprint with id/timestamps; goal defaults to empty string", async () => {
	const store = createSprintStore(db);
	const sprint = await store.create(USER_A, { name: "Sprint 1" });
	expect(sprint.id).toBeTruthy();
	expect(sprint.status).toBe("future");
	expect(sprint.goal).toBe("");
	expect(sprint.userId).toBe(USER_A);
	expect(typeof sprint.createdAt).toBe("string");
	expect(typeof sprint.updatedAt).toBe("string");
	expect(sprint.startDate).toBeNull();
	expect(sprint.endDate).toBeNull();
});

it("create with startDate/endDate ISO strings round-trips correctly", async () => {
	const store = createSprintStore(db);
	const startDate = "2026-01-01T00:00:00.000Z";
	const endDate = "2026-01-14T00:00:00.000Z";
	const sprint = await store.create(USER_A, {
		name: "Dated Sprint",
		startDate,
		endDate,
	});
	expect(sprint.startDate).toBe(startDate);
	expect(sprint.endDate).toBe(endDate);
});

it("active returns null when no active sprint exists", async () => {
	const store = createSprintStore(db);
	await store.create(USER_A, { name: "Future Sprint" });
	const active = await store.active(USER_A);
	expect(active).toBeNull();
});

it("active returns the sprint after setStatus to active", async () => {
	const store = createSprintStore(db);
	const sprint = await store.create(USER_A, { name: "Sprint 2" });
	await store.setStatus(USER_A, sprint.id, "active");
	const active = await store.active(USER_A);
	expect(active).not.toBeNull();
	expect(active?.id).toBe(sprint.id);
	expect(active?.status).toBe("active");
});

const TWO_SPRINTS = 2;

it("list returns all of the user's sprints", async () => {
	const store = createSprintStore(db);
	await store.create(USER_A, { name: "First" });
	await store.create(USER_A, { name: "Second" });
	const sprints = await store.list(USER_A);
	expect(sprints.length).toBe(TWO_SPRINTS);
	const names = sprints.map((s) => s.name);
	expect(names).toContain("First");
	expect(names).toContain("Second");
});

it("list does not return other users' sprints", async () => {
	const store = createSprintStore(db);
	await store.create(USER_A, { name: "A Sprint" });
	await store.create(USER_B, { name: "B Sprint" });
	const aSprints = await store.list(USER_A);
	expect(aSprints.length).toBe(1);
	expect(aSprints[0]?.name).toBe("A Sprint");
});

it("update patches name, goal, and dates", async () => {
	const store = createSprintStore(db);
	const sprint = await store.create(USER_A, { name: "Original" });
	const updated = await store.update(USER_A, sprint.id, {
		name: "Updated",
		goal: "Ship it",
		startDate: "2026-02-01T00:00:00.000Z",
		endDate: "2026-02-14T00:00:00.000Z",
	});
	expect(updated?.name).toBe("Updated");
	expect(updated?.goal).toBe("Ship it");
	expect(updated?.startDate).toBe("2026-02-01T00:00:00.000Z");
	expect(updated?.endDate).toBe("2026-02-14T00:00:00.000Z");
});

it("setStatus changes the sprint status", async () => {
	const store = createSprintStore(db);
	const sprint = await store.create(USER_A, { name: "Sprint 3" });
	const updated = await store.setStatus(USER_A, sprint.id, "active");
	expect(updated?.status).toBe("active");
	const completed = await store.setStatus(USER_A, sprint.id, "completed");
	expect(completed?.status).toBe("completed");
});

it("remove deletes the sprint", async () => {
	const store = createSprintStore(db);
	const sprint = await store.create(USER_A, { name: "To Delete" });
	expect(await store.remove(USER_A, sprint.id)).toBe(true);
	expect(await store.get(USER_A, sprint.id)).toBeNull();
});

it("cross-user isolation: USER_B cannot get/update/setStatus/remove USER_A's sprint", async () => {
	const store = createSprintStore(db);
	const sprint = await store.create(USER_A, { name: "Secret Sprint" });
	expect(await store.get(USER_B, sprint.id)).toBeNull();
	expect(await store.update(USER_B, sprint.id, { name: "Hacked" })).toBeNull();
	expect(await store.setStatus(USER_B, sprint.id, "active")).toBeNull();
	expect(await store.remove(USER_B, sprint.id)).toBe(false);
});
