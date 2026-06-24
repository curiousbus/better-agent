import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createMessageStore } from "./message-store";
import { createSessionStore } from "./session-store";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

const AGENT_ID = "11111111-1111-1111-1111-111111111111";

async function newSessionId(): Promise<string> {
	const session = await createSessionStore(db).create({ agentId: AGENT_ID });
	return session.id;
}

it("createMessage assigns monotonic seq from 0 within a session", async () => {
	const store = createMessageStore(db);
	const sessionId = await newSessionId();
	const first = await store.createMessage({
		sessionId,
		role: "user",
		status: "complete",
		providerId: null,
		modelId: null,
	});
	const second = await store.createMessage({
		sessionId,
		role: "assistant",
		status: "streaming",
		providerId: "openai",
		modelId: "gpt-x",
	});
	expect(first.seq).toBe(0);
	expect(second.seq).toBe(1);
	expect(second.providerId).toBe("openai");
});

it("updateMessage patches status/usage/finishReason and returns null for missing id", async () => {
	const store = createMessageStore(db);
	const sessionId = await newSessionId();
	const created = await store.createMessage({
		sessionId,
		role: "assistant",
		status: "streaming",
		providerId: "openai",
		modelId: "gpt-x",
	});
	const updated = await store.updateMessage(created.id, {
		status: "complete",
		finishReason: "stop",
		usage: {
			inputTokens: 10,
			outputTokens: 20,
			totalTokens: 30,
			reasoningTokens: null,
			cacheReadTokens: null,
			cacheWriteTokens: null,
			costCents: null,
		},
	});
	expect(updated?.status).toBe("complete");
	expect(updated?.finishReason).toBe("stop");
	expect(updated?.usage).toEqual({
		inputTokens: 10,
		outputTokens: 20,
		totalTokens: 30,
		reasoningTokens: null,
		cacheReadTokens: null,
		cacheWriteTokens: null,
		costCents: null,
	});
	expect(
		await store.updateMessage("00000000-0000-0000-0000-000000000000", {
			status: "error",
		})
	).toBeNull();
});

it("appendPart assigns monotonic seq from 0 within a message", async () => {
	const store = createMessageStore(db);
	const sessionId = await newSessionId();
	const message = await store.createMessage({
		sessionId,
		role: "assistant",
		status: "streaming",
		providerId: "openai",
		modelId: "gpt-x",
	});
	const p0 = await store.appendPart({
		messageId: message.id,
		type: "text",
		content: { text: "hello" },
		status: "streaming",
	});
	const p1 = await store.appendPart({
		messageId: message.id,
		type: "text",
		content: { text: " world" },
		status: "complete",
	});
	expect(p0.seq).toBe(0);
	expect(p1.seq).toBe(1);
	expect(p0.type).toBe("text");
});

it("updatePart patches content/status and returns null for missing id", async () => {
	const store = createMessageStore(db);
	const sessionId = await newSessionId();
	const message = await store.createMessage({
		sessionId,
		role: "assistant",
		status: "streaming",
		providerId: "openai",
		modelId: "gpt-x",
	});
	const part = await store.appendPart({
		messageId: message.id,
		type: "text",
		content: { text: "hi" },
		status: "streaming",
	});
	const updated = await store.updatePart(part.id, {
		content: { text: "hi there" },
		status: "complete",
	});
	expect(updated?.content).toEqual({ text: "hi there" });
	expect(updated?.status).toBe("complete");
	expect(
		await store.updatePart("00000000-0000-0000-0000-000000000000", {
			status: "error",
		})
	).toBeNull();
});

it("listWithParts returns messages ordered by seq, each with its parts", async () => {
	const store = createMessageStore(db);
	const sessionId = await newSessionId();
	const user = await store.createMessage({
		sessionId,
		role: "user",
		status: "complete",
		providerId: null,
		modelId: null,
	});
	await store.appendPart({
		messageId: user.id,
		type: "text",
		content: { text: "question" },
		status: "complete",
	});
	const assistant = await store.createMessage({
		sessionId,
		role: "assistant",
		status: "complete",
		providerId: "openai",
		modelId: "gpt-x",
	});
	await store.appendPart({
		messageId: assistant.id,
		type: "text",
		content: { text: "answer" },
		status: "complete",
	});

	const history = await store.listWithParts(sessionId);
	expect(history.map((h) => h.message.role)).toEqual(["user", "assistant"]);
	expect(history[0]?.parts[0]?.content).toEqual({ text: "question" });
	expect(history[1]?.parts[0]?.content).toEqual({ text: "answer" });
});

it("listWithParts returns an empty array for a session with no messages", async () => {
	const store = createMessageStore(db);
	const sessionId = await newSessionId();
	expect(await store.listWithParts(sessionId)).toEqual([]);
});
