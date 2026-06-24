import { expect, it } from "vitest";
import {
	createFakeMagicLinkStore,
	createFakeRefreshTokenStore,
	createFakeUserStore,
} from "./fake-auth-stores";

const FUTURE = new Date(Date.now() + 60_000);
const PAST = new Date(Date.now() - 60_000);

it("user store find-or-creates by email idempotently", async () => {
	const store = createFakeUserStore();
	const a = await store.findOrCreate("x@y.com");
	const b = await store.findOrCreate("x@y.com");
	expect(a.id).toBe(b.id);
	expect((await store.findById(a.id))?.email).toBe("x@y.com");
});

it("magic link consume is single-use and rejects expired", async () => {
	const store = createFakeMagicLinkStore();
	await store.create({ tokenHash: "h1", email: "x@y.com", expiresAt: FUTURE });
	expect(await store.consume("h1")).toEqual({ email: "x@y.com" });
	expect(await store.consume("h1")).toBeNull();
	await store.create({ tokenHash: "h2", email: "x@y.com", expiresAt: PAST });
	expect(await store.consume("h2")).toBeNull();
});

it("refresh token find/revoke works and revokeAllForUser revokes every row", async () => {
	const store = createFakeRefreshTokenStore();
	await store.create({ userId: "u1", tokenHash: "r1", expiresAt: FUTURE });
	const found = await store.find("r1");
	expect(found?.userId).toBe("u1");
	expect(found?.revokedAt).toBeNull();
	await store.revoke(found?.id ?? "");
	expect((await store.find("r1"))?.revokedAt).toBeInstanceOf(Date);
});
