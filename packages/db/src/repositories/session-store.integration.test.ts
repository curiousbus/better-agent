import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createSessionStore } from "./session-store";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

const AGENT_ID = "11111111-1111-1111-1111-111111111111";

it("create returns an active session with id and timestamps", async () => {
	const store = createSessionStore(db);
	const created = await store.create({ agentId: AGENT_ID });
	expect(created.id).toBeTruthy();
	expect(created.agentId).toBe(AGENT_ID);
	expect(created.status).toBe("active");
	expect(created.title).toBeNull();
	expect(created.summary).toBeNull();
	expect(created.compactedThroughSeq).toBeNull();
	expect(created.createdAt).toBeInstanceOf(Date);
});

it("get returns the created session and null for missing id", async () => {
	const store = createSessionStore(db);
	const created = await store.create({ agentId: AGENT_ID });
	expect((await store.get(created.id))?.agentId).toBe(AGENT_ID);
	expect(await store.get("00000000-0000-0000-0000-000000000000")).toBeNull();
});

it("list returns all sessions", async () => {
	const store = createSessionStore(db);
	await store.create({ agentId: AGENT_ID });
	await store.create({ agentId: AGENT_ID });
	expect((await store.list()).length).toBe(2);
});

it("setStatus and setTitle update the row", async () => {
	const store = createSessionStore(db);
	const created = await store.create({ agentId: AGENT_ID });
	await store.setTitle(created.id, "First chat");
	await store.setStatus(created.id, "error");
	const reread = await store.get(created.id);
	expect(reread?.title).toBe("First chat");
	expect(reread?.status).toBe("error");
});

it("setSummary persists summary and compactedThroughSeq", async () => {
	const store = createSessionStore(db);
	const created = await store.create({ agentId: AGENT_ID });
	await store.setSummary(created.id, "summary so far", 4);
	const reread = await store.get(created.id);
	expect(reread?.summary).toBe("summary so far");
	expect(reread?.compactedThroughSeq).toBe(4);
});

it("persists userId and lists by user", async () => {
	const store = createSessionStore(db);
	const USER_1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
	const USER_2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
	const mine = await store.create({ agentId: AGENT_ID, userId: USER_1 });
	await store.create({ agentId: AGENT_ID, userId: USER_2 });
	await store.create({ agentId: AGENT_ID }); // null user
	expect(mine.userId).toBe(USER_1);
	const u1 = await store.listByUser(USER_1);
	expect(u1.map((s) => s.id)).toEqual([mine.id]);
});
