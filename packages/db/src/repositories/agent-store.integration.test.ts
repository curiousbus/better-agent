import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createAgentStore } from "./agent-store";

const box = createSecretBox("integration-test-secret-key-please-32+");

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
	tokenHash: "hash-1",
};

it("create returns a row with generated id and timestamps", async () => {
	const store = createAgentStore(db, box);
	const created = await store.create(INPUT);
	expect(created.id).toBeTruthy();
	expect(created.name).toBe("Helper");
	expect(created.params).toBeNull();
	expect(created.createdAt).toBeInstanceOf(Date);
});

it("get returns the created agent and null for missing id", async () => {
	const store = createAgentStore(db, box);
	const created = await store.create(INPUT);
	expect((await store.get(created.id))?.name).toBe("Helper");
	expect(await store.get("00000000-0000-0000-0000-000000000000")).toBeNull();
});

it("list returns all agents", async () => {
	const store = createAgentStore(db, box);
	await store.create(INPUT);
	await store.create({ ...INPUT, name: "Second", tokenHash: "hash-2" });
	expect((await store.list()).length).toBe(2);
});

it("listByUser returns only that user's agents and excludes null-owner", async () => {
	const store = createAgentStore(db, box);
	const [alice] = await db
		.insert(users)
		.values({ email: "alice@x.com" })
		.returning();
	const [bob] = await db
		.insert(users)
		.values({ email: "bob@x.com" })
		.returning();
	const owned = await store.create({
		...INPUT,
		tokenHash: "h-a",
		userId: alice?.id,
	});
	await store.create({
		...INPUT,
		name: "Bob",
		tokenHash: "h-b",
		userId: bob?.id,
	});
	await store.create({ ...INPUT, name: "Legacy", tokenHash: "h-legacy" });

	const aliceAgents = await store.listByUser(alice?.id ?? "");
	expect(aliceAgents).toHaveLength(1);
	expect(aliceAgents[0]?.id).toBe(owned.id);
	expect(aliceAgents[0]?.userId).toBe(alice?.id);
	expect((await store.list()).length).toBe(3);
});

it("update changes fields and returns null for missing id", async () => {
	const store = createAgentStore(db, box);
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
	const store = createAgentStore(db, box);
	const created = await store.create(INPUT);
	await store.delete(created.id);
	expect(await store.get(created.id)).toBeNull();
});

it("findByTokenHash returns the agent for a known hash and null otherwise", async () => {
	const store = createAgentStore(db, box);
	const created = await store.create(INPUT);
	expect((await store.findByTokenHash("hash-1"))?.id).toBe(created.id);
	expect(await store.findByTokenHash("nope")).toBeNull();
});

it("rotateToken swaps the hash so the old one stops resolving", async () => {
	const store = createAgentStore(db, box);
	const created = await store.create(INPUT);
	await store.rotateToken(created.id, "hash-2");
	expect(await store.findByTokenHash("hash-1")).toBeNull();
	expect((await store.findByTokenHash("hash-2"))?.id).toBe(created.id);
});

it("create rejects a duplicate token hash", async () => {
	const store = createAgentStore(db, box);
	await store.create(INPUT);
	await expect(
		store.create({ ...INPUT, name: "Other", tokenHash: "hash-1" })
	).rejects.toThrow();
});

it("getToken round-trips the encrypted token; rotateToken replaces it", async () => {
	const store = createAgentStore(db, box);
	const created = await store.create({ ...INPUT, token: "ba_original" });
	expect(await store.getToken(created.id)).toBe("ba_original");
	await store.rotateToken(created.id, "hash-2", "ba_rotated");
	expect(await store.getToken(created.id)).toBe("ba_rotated");
	expect(
		await store.getToken("00000000-0000-0000-0000-000000000000")
	).toBeNull();
});
