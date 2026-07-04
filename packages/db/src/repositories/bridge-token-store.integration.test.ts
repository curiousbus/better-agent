import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createBridgeTokenStore } from "./bridge-token-store";

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

it("create returns a row with generated id, timestamps and no hash/plaintext", async () => {
	const store = createBridgeTokenStore(db);
	const userId = await seedUser("alice@x.com");
	const token = generateToken("bt_");

	const created = await store.create({
		userId,
		name: "laptop",
		tokenHash: hashToken(token),
		last4: token.slice(-4),
	});

	expect(created.id).toBeTruthy();
	expect(created.userId).toBe(userId);
	expect(created.name).toBe("laptop");
	expect(created.last4).toBe(token.slice(-4));
	expect(created.createdAt).toBeInstanceOf(Date);
	expect(created.revokedAt).toBeNull();
	expect(created).not.toHaveProperty("tokenHash");
});

it("findByHash resolves an active token and returns null for unknown/revoked hashes", async () => {
	const store = createBridgeTokenStore(db);
	const userId = await seedUser("alice@x.com");
	const token = generateToken("bt_");
	const tokenHash = hashToken(token);
	const created = await store.create({ userId, tokenHash });

	const found = await store.findByHash(tokenHash);
	expect(found).toEqual({ id: created.id, userId, revokedAt: null });
	expect(await store.findByHash("nope")).toBeNull();

	await store.revoke(created.id, userId);
	const afterRevoke = await store.findByHash(tokenHash);
	expect(afterRevoke?.revokedAt).toBeInstanceOf(Date);
});

it("listByUser scopes tokens per owner", async () => {
	const store = createBridgeTokenStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	await store.create({
		userId: alice,
		tokenHash: hashToken(generateToken("bt_")),
	});
	await store.create({
		userId: alice,
		tokenHash: hashToken(generateToken("bt_")),
	});
	await store.create({
		userId: bob,
		tokenHash: hashToken(generateToken("bt_")),
	});

	const aliceTokens = await store.listByUser(alice);
	expect(aliceTokens).toHaveLength(2);
	expect(aliceTokens.every((row) => row.userId === alice)).toBe(true);
	expect(await store.listByUser(bob)).toHaveLength(1);
});

it("revoke only affects the owner's own token", async () => {
	const store = createBridgeTokenStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const tokenHash = hashToken(generateToken("bt_"));
	const created = await store.create({ userId: alice, tokenHash });

	await store.revoke(created.id, bob);
	expect((await store.findByHash(tokenHash))?.revokedAt).toBeNull();

	await store.revoke(created.id, alice);
	expect((await store.findByHash(tokenHash))?.revokedAt).toBeInstanceOf(Date);
});

it("create rejects a duplicate token hash", async () => {
	const store = createBridgeTokenStore(db);
	const userId = await seedUser("alice@x.com");
	const tokenHash = hashToken(generateToken("bt_"));
	await store.create({ userId, tokenHash });
	await expect(store.create({ userId, tokenHash })).rejects.toThrow();
});
