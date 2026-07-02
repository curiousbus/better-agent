import type { MessageUsage } from "@better-agent/agent/session/types";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { messages, sessions } from "../schema/sessions";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createUsageStore } from "./usage-store";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

const usage = (
	inputTokens: number,
	outputTokens: number,
	costCents: number
): MessageUsage => ({
	inputTokens,
	outputTokens,
	costCents,
	totalTokens: inputTokens + outputTokens,
	reasoningTokens: null,
	cacheReadTokens: null,
	cacheWriteTokens: null,
});

async function seedUser(email: string): Promise<string> {
	const [row] = await db.insert(users).values({ email }).returning();
	return row?.id ?? "";
}

async function seedSession(userId: string): Promise<string> {
	const [row] = await db
		.insert(sessions)
		.values({ agentId: crypto.randomUUID(), userId })
		.returning();
	return row?.id ?? "";
}

function msg(
	sessionId: string,
	seq: number,
	role: "assistant" | "user",
	createdAt: Date,
	use: MessageUsage | null
) {
	return {
		sessionId,
		role,
		seq,
		status: "complete" as const,
		createdAt,
		usage: use,
	};
}

const DAY = new Date("2026-06-30T10:00:00.000Z");
const SINCE = new Date("2026-06-01T00:00:00.000Z");

it("dailySummary aggregates the user's assistant-message usage per day", async () => {
	const store = createUsageStore(db);
	const meId = await seedUser("me@x.com");
	const mine = await seedSession(meId);
	const theirs = await seedSession(await seedUser("other@x.com"));
	await db.insert(messages).values([
		msg(mine, 1, "assistant", DAY, usage(100, 50, 2)),
		msg(mine, 2, "assistant", DAY, usage(20, 10, 1)),
		msg(mine, 3, "user", DAY, null), // ignored: not assistant
		msg(theirs, 1, "assistant", DAY, usage(999, 999, 99)), // ignored: other user
	]);

	const summary = await store.dailySummary(meId, SINCE);
	expect(summary).toHaveLength(1);
	expect(summary[0]?.day).toBe("2026-06-30");
	expect(summary[0]?.inputTokens).toBe(120);
	expect(summary[0]?.outputTokens).toBe(60);
	expect(summary[0]?.costCents).toBe(3);
	expect(summary[0]?.turns).toBe(2);
});

it("dailySummary excludes messages older than the since date", async () => {
	const store = createUsageStore(db);
	const meId = await seedUser("a@x.com");
	const s = await seedSession(meId);
	await db
		.insert(messages)
		.values(
			msg(
				s,
				1,
				"assistant",
				new Date("2026-05-01T00:00:00.000Z"),
				usage(10, 10, 1)
			)
		);
	expect(await store.dailySummary(meId, SINCE)).toHaveLength(0);
});
