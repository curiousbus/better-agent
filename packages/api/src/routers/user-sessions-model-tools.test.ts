import type {
	LanguageModelV3,
	LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import type { SprintStore, TaskStore } from "@better-agent/agent/ports";
import type { RunEvent } from "@better-agent/agent/session/events";
import { createSessionRuntime } from "@better-agent/agent/session/runtime";
import { createInMemorySessionLock } from "@better-agent/agent/session/session-lock";
import type { Task } from "@better-agent/agent/task/types";
import { createFakeAgentStore } from "@better-agent/agent/testing/fake-agent-store";
import {
	createFakeCatalogStore,
	createFakeMessageStore,
	createFakeModelStore,
	createFakeSessionStore,
	createFakeSummarizer,
} from "@better-agent/agent/testing/fakes";
import { createInMemoryPendingToolCallStore } from "@better-agent/agent/tool/pending-store";
import { createRouterClient } from "@orpc/server";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { expect, it } from "vitest";
import { appRouter } from "./index";

// ── token constants ──────────────────────────────────────────────────────────
const INPUT_TOKENS_1 = 10;
const OUTPUT_TOKENS_1 = 5;
const INPUT_TOKENS_2 = 15;
const OUTPUT_TOKENS_2 = 3;

const USER_ID = "00000000-0000-0000-0000-000000000022";
const STAMP = "2026-06-30T00:00:00.000Z";

function v3Usage(input: number, output: number) {
	return {
		inputTokens: {
			total: input,
			noCache: undefined,
			cacheRead: undefined,
			cacheWrite: undefined,
		},
		outputTokens: { total: output, text: undefined, reasoning: undefined },
	};
}

// ── in-memory TaskStore ──────────────────────────────────────────────────────
function memoryTaskStore(): TaskStore {
	const rows: Task[] = [];
	let seq = 0;
	return {
		listBacklog: (u) =>
			Promise.resolve(
				rows.filter((r) => r.userId === u && r.sprintId === null)
			),
		listColumn: (u, sprintId, status) =>
			Promise.resolve(
				rows.filter(
					(r) =>
						r.userId === u && r.sprintId === sprintId && r.status === status
				)
			),
		get: (u, id) =>
			Promise.resolve(rows.find((r) => r.userId === u && r.id === id) ?? null),
		create: (u, input) => {
			seq += 1;
			const task: Task = {
				id: `t${seq}`,
				seq,
				userId: u,
				title: input.title,
				description: "",
				status: input.status ?? "todo",
				sprintId: input.sprintId ?? null,
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

// ── in-memory SprintStore (stub) ─────────────────────────────────────────────
function memorySprintStore(): SprintStore {
	return {
		list: () => Promise.resolve([]),
		active: () => Promise.resolve(null),
		get: () => Promise.resolve(null),
		create: () => Promise.reject(new Error("not implemented")),
		update: () => Promise.resolve(null),
		setStatus: () => Promise.resolve(null),
		remove: () => Promise.resolve(false),
	};
}

// ── two-step model chunks ────────────────────────────────────────────────────
const STEP1: LanguageModelV3StreamPart[] = [
	{
		type: "tool-call",
		toolCallId: "c1",
		toolName: "createTask",
		input: JSON.stringify({ title: "from model" }),
	},
	{
		type: "finish",
		finishReason: { unified: "tool-calls", raw: "tool_calls" },
		usage: v3Usage(INPUT_TOKENS_1, OUTPUT_TOKENS_1),
	},
];

const STEP2: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "Created." },
	{ type: "text-end", id: "0" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: v3Usage(INPUT_TOKENS_2, OUTPUT_TOKENS_2),
	},
];

// ── harness ──────────────────────────────────────────────────────────────────
const AGENT_SEED = {
	name: "Helper",
	description: "d",
	systemPrompt: "You are helpful.",
	providerId: "openai",
	modelId: "gpt-x",
	params: null,
	tokenHash: "hash-model-tools",
} as const;

function buildModelToolServices(model: LanguageModelV3, taskStore: TaskStore) {
	const agentStore = createFakeAgentStore();
	const sessionStore = createFakeSessionStore();
	const messageStore = createFakeMessageStore();
	const runtime = createSessionRuntime({
		sessionStore,
		messageStore,
		agentStore,
		modelFactory: { create: () => Promise.resolve(model) },
		sessionLock: createInMemorySessionLock(),
		modelCacheStore: createFakeModelStore(),
		providerCatalogStore: createFakeCatalogStore(),
		summarizer: createFakeSummarizer(),
	});
	const pendingToolCallStore = createInMemoryPendingToolCallStore();
	const services = {
		authz: { enabled: false },
		runtime,
		pendingToolCallStore,
		stores: {
			agent: agentStore,
			session: sessionStore,
			message: messageStore,
			task: taskStore,
			sprint: memorySprintStore(),
		},
	};
	return { agentStore, sessionStore, services };
}

// ── test ─────────────────────────────────────────────────────────────────────
it("model turn can call createTask and the task is persisted in the store", async () => {
	let callStep = 0;
	const model = new MockLanguageModelV3({
		doStream: () => {
			callStep += 1;
			const chunks = callStep === 1 ? STEP1 : STEP2;
			return Promise.resolve({ stream: simulateReadableStream({ chunks }) });
		},
	});

	const taskStore = memoryTaskStore();
	const { agentStore, sessionStore, services } = buildModelToolServices(
		model,
		taskStore
	);

	const agent = await agentStore.create(AGENT_SEED);
	const session = await sessionStore.create({
		agentId: agent.id,
		userId: USER_ID,
	});

	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: { id: USER_ID, email: "x@y.com", createdAt: new Date() },
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});

	const events: RunEvent[] = [];
	for await (const e of await client.userSessions.prompt({
		sessionId: session.id,
		text: "make a task",
	})) {
		events.push(e);
	}

	const tasks = await taskStore.listBacklog(USER_ID);
	expect(tasks).toHaveLength(1);
	expect(tasks[0]?.title).toBe("from model");
});
