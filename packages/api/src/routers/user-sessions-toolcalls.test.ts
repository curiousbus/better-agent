import type { TaskStore } from "@better-agent/agent/ports";
import type { RunEvent } from "@better-agent/agent/session/events";
import type { Task } from "@better-agent/agent/task/types";
import { createFakeSessionStore } from "@better-agent/agent/testing/fakes";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const USER_ID = "00000000-0000-0000-0000-000000000111";
const AGENT_ID = "00000000-0000-0000-0000-0000000000aa";
const STAMP = "2026-06-30T00:00:00.000Z";

// Minimal in-memory TaskStore: only the reads + create paths are exercised here.
function memoryTaskStore(): TaskStore {
	const rows: Task[] = [];
	let seq = 0;
	return {
		list: (u) => Promise.resolve(rows.filter((r) => r.userId === u)),
		listColumn: (u, status) =>
			Promise.resolve(
				rows.filter((r) => r.userId === u && r.status === status)
			),
		get: (u, id) =>
			Promise.resolve(rows.find((r) => r.userId === u && r.id === id) ?? null),
		create: (u, input) => {
			seq += 1;
			const task: Task = {
				id: `t${seq}`,
				userId: u,
				title: input.title,
				description: "",
				status: input.status ?? "todo",
				position: seq,
				createdAt: STAMP,
				updatedAt: STAMP,
			};
			rows.push(task);
			return Promise.resolve(task);
		},
		update: () => Promise.resolve(null),
		move: () => Promise.resolve(null),
		remove: () => Promise.resolve(false),
	};
}

async function setup() {
	const sessionStore = createFakeSessionStore();
	const session = await sessionStore.create({
		agentId: AGENT_ID,
		userId: USER_ID,
	});
	const services = {
		authz: { enabled: false },
		stores: { session: sessionStore, task: memoryTaskStore() },
	};
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: { id: USER_ID, email: "x@y.com", createdAt: new Date() },
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	return { client, session };
}

it("toolCalls mode runs tools directly and streams a result then done", async () => {
	const { client, session } = await setup();
	const events: RunEvent[] = [];
	for await (const event of await client.userSessions.prompt({
		sessionId: session.id,
		toolCalls: [
			{ callId: "c1", name: "createTask", args: { title: "from-tool" } },
		],
	})) {
		events.push(event);
	}
	const result = events.find((e) => e.type === "tool-result");
	if (result?.type !== "tool-result") {
		throw new Error("expected a tool-result event");
	}
	expect(JSON.parse(String(result.result)).title).toBe("from-tool");
	expect(events.at(-1)?.type).toBe("done");
});

it("an unknown tool name yields an isError result for that call only", async () => {
	const { client, session } = await setup();
	const events: RunEvent[] = [];
	for await (const event of await client.userSessions.prompt({
		sessionId: session.id,
		toolCalls: [{ callId: "c9", name: "nope", args: {} }],
	})) {
		events.push(event);
	}
	const result = events.find((e) => e.type === "tool-result");
	expect(result?.type === "tool-result" && result.isError).toBe(true);
	expect(events.at(-1)?.type).toBe("done");
});
