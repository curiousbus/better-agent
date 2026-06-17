import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createAgentStore } from "./agent-store";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

const INPUT = {
	name: "Helper",
	description: "A helpful agent",
	systemPrompt: "You are helpful.",
	providerId: "anthropic",
	modelId: "claude-opus-4-5",
	params: null,
};

it("create returns a row with generated id and timestamps", async () => {
	const store = createAgentStore(db);
	const created = await store.create(INPUT);
	expect(created.id).toBeTruthy();
	expect(created.name).toBe("Helper");
	expect(created.params).toBeNull();
	expect(created.createdAt).toBeInstanceOf(Date);
});

it("get returns the created agent and null for missing id", async () => {
	const store = createAgentStore(db);
	const created = await store.create(INPUT);
	expect((await store.get(created.id))?.name).toBe("Helper");
	expect(await store.get("00000000-0000-0000-0000-000000000000")).toBeNull();
});

it("list returns all agents", async () => {
	const store = createAgentStore(db);
	await store.create(INPUT);
	await store.create({ ...INPUT, name: "Second" });
	expect((await store.list()).length).toBe(2);
});

it("update changes fields and returns null for missing id", async () => {
	const store = createAgentStore(db);
	const created = await store.create(INPUT);
	const updated = await store.update(created.id, {
		...INPUT,
		name: "Renamed",
		params: { temperature: 0.5, topP: null, maxOutputTokens: 2000 },
	});
	expect(updated?.name).toBe("Renamed");
	expect(updated?.params).toEqual({
		temperature: 0.5,
		topP: null,
		maxOutputTokens: 2000,
	});
	expect(
		await store.update("00000000-0000-0000-0000-000000000000", INPUT)
	).toBeNull();
});

it("delete removes the agent", async () => {
	const store = createAgentStore(db);
	const created = await store.create(INPUT);
	await store.delete(created.id);
	expect(await store.get(created.id)).toBeNull();
});
