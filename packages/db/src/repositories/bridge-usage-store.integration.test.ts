import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import type { BridgeAgentKind } from "@better-agent/agent/ports";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { bridgeMessages, bridgeSessions, bridgeTokens } from "../schema/bridge";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createBridgeUsageStore } from "./bridge-usage-store";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

const SINCE = new Date("2026-06-01T00:00:00.000Z");
const IN_WINDOW = new Date("2026-06-30T10:00:00.000Z");
const BEFORE_WINDOW = new Date("2026-05-01T00:00:00.000Z");

async function seedUser(email: string): Promise<string> {
	const [row] = await db.insert(users).values({ email }).returning();
	return row?.id ?? "";
}

async function seedSession(
	userId: string,
	agentKind: BridgeAgentKind
): Promise<string> {
	const [token] = await db
		.insert(bridgeTokens)
		.values({ userId, agentKind, tokenHash: hashToken(generateToken("bt_")) })
		.returning();
	const [session] = await db
		.insert(bridgeSessions)
		.values({ userId, tokenId: token?.id ?? "", agentKind })
		.returning();
	return session?.id ?? "";
}

// A persisted claude-code `turn_usage` event: camelCase `detail.costUsd`, but a
// snake_case raw-claude `detail.usage`.
function turnUsageEvent(
	costUsd: number,
	inputTokens: number,
	outputTokens: number,
	cacheReadTokens: number,
	cacheCreationTokens: number
) {
	return {
		kind: "status",
		status: "turn_usage",
		detail: {
			costUsd,
			numTurns: 1,
			durationMs: 1000,
			usage: {
				input_tokens: inputTokens,
				output_tokens: outputTokens,
				cache_read_input_tokens: cacheReadTokens,
				cache_creation_input_tokens: cacheCreationTokens,
			},
		},
	};
}

async function appendEvent(
	sessionId: string,
	seq: number,
	event: unknown,
	createdAt: Date
): Promise<void> {
	await db.insert(bridgeMessages).values({ sessionId, seq, event, createdAt });
}

it("sums cost + tokens grouped by agentKind for the owner's turn_usage events", async () => {
	const store = createBridgeUsageStore(db);
	const meId = await seedUser("me@x.com");
	const claude = await seedSession(meId, "claude-code");
	const codex = await seedSession(meId, "codex");

	await appendEvent(claude, 1, turnUsageEvent(0.5, 100, 40, 10, 5), IN_WINDOW);
	await appendEvent(claude, 2, turnUsageEvent(0.25, 20, 8, 2, 1), IN_WINDOW);
	// A non-usage event on the same session must be ignored.
	await appendEvent(claude, 3, { kind: "output", text: "hi" }, IN_WINDOW);
	await appendEvent(codex, 1, turnUsageEvent(1, 200, 60, 30, 0), IN_WINDOW);

	const rows = await store.usageByAgentKind(meId, SINCE);
	const byKind = new Map(rows.map((row) => [row.agentKind, row]));

	expect(byKind.get("claude-code")).toEqual({
		agentKind: "claude-code",
		costUsd: 0.75,
		inputTokens: 120,
		outputTokens: 48,
		cacheReadTokens: 12,
		cacheCreationTokens: 6,
		turns: 2,
	});
	expect(byKind.get("codex")?.turns).toBe(1);
	expect(byKind.get("codex")?.costUsd).toBe(1);
});

it("excludes other users' sessions and events before the since date", async () => {
	const store = createBridgeUsageStore(db);
	const meId = await seedUser("mine@x.com");
	const mine = await seedSession(meId, "claude-code");
	const theirs = await seedSession(
		await seedUser("other@x.com"),
		"claude-code"
	);

	await appendEvent(mine, 1, turnUsageEvent(0.4, 50, 20, 0, 0), IN_WINDOW);
	// Excluded: before the window.
	await appendEvent(mine, 2, turnUsageEvent(9, 900, 900, 0, 0), BEFORE_WINDOW);
	// Excluded: another user.
	await appendEvent(theirs, 1, turnUsageEvent(9, 999, 999, 0, 0), IN_WINDOW);

	const rows = await store.usageByAgentKind(meId, SINCE);
	expect(rows).toHaveLength(1);
	expect(rows[0]?.costUsd).toBe(0.4);
	expect(rows[0]?.inputTokens).toBe(50);
});

it("coalesces missing token usage to zero for a turn_usage event", async () => {
	const store = createBridgeUsageStore(db);
	const meId = await seedUser("z@x.com");
	const claude = await seedSession(meId, "claude-code");
	// A turn_usage event with a cost but no `usage` object at all.
	await appendEvent(
		claude,
		1,
		{ kind: "status", status: "turn_usage", detail: { costUsd: 0.1 } },
		IN_WINDOW
	);

	const rows = await store.usageByAgentKind(meId, SINCE);
	expect(rows[0]?.costUsd).toBe(0.1);
	expect(rows[0]?.inputTokens).toBe(0);
	expect(rows[0]?.turns).toBe(1);
});
