import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createComposioAccountStore } from "./composio-account-store";

const box = createSecretBox("integration-test-secret-key-please-32+");

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

async function seedUser(email: string): Promise<string> {
	const [row] = await db.insert(users).values({ email }).returning();
	return row?.id ?? "";
}

it("listByUser returns only the owner's accounts and excludes legacy null-owner", async () => {
	const store = createComposioAccountStore(db, box);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");

	const mine = await store.create({
		name: "Mine",
		apiKey: "ck_alice_1234",
		userId: alice,
	});
	await store.create({ name: "Bobs", apiKey: "ck_bob_5678", userId: bob });
	await store.create({ name: "Legacy", apiKey: "ck_legacy_0000" });

	const aliceAccounts = await store.listByUser(alice);
	expect(aliceAccounts).toHaveLength(1);
	expect(aliceAccounts[0]?.id).toBe(mine.id);
	expect(aliceAccounts[0]?.userId).toBe(alice);
	expect(aliceAccounts[0]?.apiKeyLast4).toBe("1234");
	expect((await store.list()).length).toBe(3);
});

it("getApiKey round-trips the encrypted key", async () => {
	const store = createComposioAccountStore(db, box);
	const owner = await seedUser("k@x.com");
	const account = await store.create({
		name: "K",
		apiKey: "ck_secret_key_9999",
		userId: owner,
	});
	expect(await store.getApiKey(account.id)).toBe("ck_secret_key_9999");
});
