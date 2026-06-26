import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createSettingsStore } from "./settings-store";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

const box = createSecretBox("test-secret-for-settings-store");

it("set then get returns the original plaintext", async () => {
	const store = createSettingsStore(db, box);
	await store.set("composio.apiKey", "my-secret-value");
	const result = await store.get("composio.apiKey");
	expect(result).toBe("my-secret-value");
});

it("get returns null for a missing key", async () => {
	const store = createSettingsStore(db, box);
	const result = await store.get("nonexistent.key");
	expect(result).toBeNull();
});

it("delete removes the key so get returns null", async () => {
	const store = createSettingsStore(db, box);
	await store.set("composio.apiKey", "my-secret-value");
	await store.delete("composio.apiKey");
	const result = await store.get("composio.apiKey");
	expect(result).toBeNull();
});

it("set overwrites an existing key", async () => {
	const store = createSettingsStore(db, box);
	await store.set("composio.apiKey", "first-value");
	await store.set("composio.apiKey", "second-value");
	const result = await store.get("composio.apiKey");
	expect(result).toBe("second-value");
});

it("raw value_cipher column is not the plaintext", async () => {
	const store = createSettingsStore(db, box);
	const plaintext = "super-secret-api-key";
	await store.set("composio.apiKey", plaintext);
	const rows = await db.execute(
		`SELECT value_cipher FROM settings WHERE key = 'composio.apiKey'`
	);
	const cipher = (rows.rows[0] as { value_cipher: string }).value_cipher;
	expect(cipher).not.toBe(plaintext);
	expect(cipher.length).toBeGreaterThan(0);
});
