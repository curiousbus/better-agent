import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/test-db";
import {
	createMagicLinkStore,
	createRefreshTokenStore,
	createUserStore,
} from "./auth-store";

const FUTURE = () => new Date(Date.now() + 60_000);
const PAST = () => new Date(Date.now() - 60_000);

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});
afterEach(async () => {
	await client.close();
});

it("user findOrCreate is idempotent by email", async () => {
	const store = createUserStore(db);
	const a = await store.findOrCreate("x@y.com");
	const b = await store.findOrCreate("x@y.com");
	expect(a.id).toBe(b.id);
	expect((await store.findByEmail("x@y.com"))?.id).toBe(a.id);
});

it("magic link consume is single-use and rejects expired", async () => {
	const store = createMagicLinkStore(db);
	await store.create({
		tokenHash: "h1",
		email: "x@y.com",
		expiresAt: FUTURE(),
	});
	expect(await store.consume("h1")).toEqual({ email: "x@y.com" });
	expect(await store.consume("h1")).toBeNull();
	await store.create({ tokenHash: "h2", email: "x@y.com", expiresAt: PAST() });
	expect(await store.consume("h2")).toBeNull();
});

it("refresh token find/revoke + revokeAllForUser", async () => {
	const users = createUserStore(db);
	const user = await users.findOrCreate("x@y.com");
	const store = createRefreshTokenStore(db);
	await store.create({
		userId: user.id,
		tokenHash: "r1",
		expiresAt: FUTURE(),
	});
	const found = await store.find("r1");
	expect(found?.userId).toBe(user.id);
	await store.revoke(found?.id ?? "");
	expect((await store.find("r1"))?.revokedAt).toBeInstanceOf(Date);
	await store.create({ userId: user.id, tokenHash: "r2", expiresAt: FUTURE() });
	await store.revokeAllForUser(user.id);
	expect((await store.find("r2"))?.revokedAt).toBeInstanceOf(Date);
});
