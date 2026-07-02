import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createActivityStore } from "./activity-store";

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

it("log then listByUser returns the user's events, newest first, scoped per user", async () => {
	const store = createActivityStore(db);
	const meId = await seedUser("me@x.com");
	const otherId = await seedUser("other@x.com");
	await store.log({ userId: meId, type: "login", summary: "Signed in" });
	await store.log({
		userId: meId,
		type: "agent_created",
		summary: "Created agent “X”",
	});
	await store.log({ userId: otherId, type: "login", summary: "Signed in" });

	const events = await store.listByUser(meId);
	expect(events).toHaveLength(2);
	expect(events[0]?.type).toBe("agent_created"); // newest first
	expect(events[1]?.type).toBe("login");
	expect(events.every((e) => e.userId === meId)).toBe(true);
});
