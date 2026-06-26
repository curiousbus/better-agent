import type {
	LanguageModelV3,
	LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { createSessionRuntime } from "@better-agent/agent/session/runtime";
import { createInMemorySessionLock } from "@better-agent/agent/session/session-lock";
import { createFakeAgentStore } from "@better-agent/agent/testing/fake-agent-store";
import {
	createFakeCatalogStore,
	createFakeMessageStore,
	createFakeModelStore,
	createFakeSessionStore,
	createFakeSummarizer,
} from "@better-agent/agent/testing/fakes";
import type { ComposioService } from "@better-agent/agent/tool/composio-tools";
import { createInMemoryPendingToolCallStore } from "@better-agent/agent/tool/pending-store";
import { createRouterClient } from "@orpc/server";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";
import { appRouter } from "./index";
import { safeComposioDefs } from "./user-sessions";

const HAPPY: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "Hi there" },
	{ type: "text-end", id: "0" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: {
			inputTokens: {
				total: 3,
				noCache: undefined,
				cacheRead: undefined,
				cacheWrite: undefined,
			},
			outputTokens: { total: 2, text: undefined, reasoning: undefined },
		},
	},
];

function mockModel(chunks: LanguageModelV3StreamPart[]): LanguageModelV3 {
	return new MockLanguageModelV3({
		doStream: () =>
			Promise.resolve({ stream: simulateReadableStream({ chunks }) }),
	});
}

function buildServices() {
	const agentStore = createFakeAgentStore();
	const sessionStore = createFakeSessionStore();
	const messageStore = createFakeMessageStore();
	const runtime = createSessionRuntime({
		sessionStore,
		messageStore,
		agentStore,
		modelFactory: { create: () => Promise.resolve(mockModel(HAPPY)) },
		sessionLock: createInMemorySessionLock(),
		modelCacheStore: createFakeModelStore(),
		providerCatalogStore: createFakeCatalogStore(),
		summarizer: createFakeSummarizer(),
	});
	const pendingToolCallStore = createInMemoryPendingToolCallStore();
	const services = {
		runtime,
		pendingToolCallStore,
		stores: { agent: agentStore, session: sessionStore, message: messageStore },
	};
	return { agentStore, sessionStore, services };
}

const AGENT_SEED = {
	name: "Helper",
	description: "d",
	systemPrompt: "You are helpful.",
	providerId: "openai",
	modelId: "gpt-x",
	params: null,
	tokenHash: "hash-1",
} as const;

const USER_ID_1 = "00000000-0000-0000-0000-000000000001";
const USER_ID_2 = "00000000-0000-0000-0000-000000000002";
const UNKNOWN_AGENT_ID = "00000000-0000-0000-0000-000000000000";

it("create binds the session to the authed user and the chosen agent", async () => {
	const { agentStore, services } = buildServices();
	const agent = await agentStore.create(AGENT_SEED);
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: { id: USER_ID_1, email: "x@y.com", createdAt: new Date() },
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	const session = await client.userSessions.create({ agentId: agent.id });
	expect(session.userId).toBe(USER_ID_1);
	expect(session.agentId).toBe(agent.id);
	const list = await client.userSessions.list();
	expect(list.map((s) => s.id)).toEqual([session.id]);
});

it("list returns only the authed user's own sessions", async () => {
	const { agentStore, sessionStore, services } = buildServices();
	const agent = await agentStore.create(AGENT_SEED);
	// seed a session for a different user
	await sessionStore.create({ agentId: agent.id, userId: USER_ID_2 });
	const ownSession = await sessionStore.create({
		agentId: agent.id,
		userId: USER_ID_1,
	});
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: { id: USER_ID_1, email: "x@y.com", createdAt: new Date() },
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	const list = await client.userSessions.list();
	expect(list.map((s) => s.id)).toEqual([ownSession.id]);
});

it("get/listMessages reject another user's session as NOT_FOUND", async () => {
	const { agentStore, sessionStore, services } = buildServices();
	const agent = await agentStore.create(AGENT_SEED);
	const otherSession = await sessionStore.create({
		agentId: agent.id,
		userId: USER_ID_2,
	});
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: { id: USER_ID_1, email: "x@y.com", createdAt: new Date() },
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	await expect(
		client.userSessions.get({ id: otherSession.id })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	await expect(
		client.userSessions.listMessages({ sessionId: otherSession.id })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("create rejects an unknown agent", async () => {
	const { services } = buildServices();
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: { id: USER_ID_1, email: "x@y.com", createdAt: new Date() },
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	await expect(
		client.userSessions.create({ agentId: UNKNOWN_AGENT_ID })
	).rejects.toThrow();
});

it("rejects unauthenticated callers", async () => {
	const { agentStore, services } = buildServices();
	const agent = await agentStore.create(AGENT_SEED);
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: null,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	await expect(
		client.userSessions.create({ agentId: agent.id })
	).rejects.toThrow();
});

const okService: ComposioService = {
	listToolkits: () => Promise.resolve([]),
	listTools: (_userId, _toolkits) =>
		Promise.resolve([
			{ name: "HACKERNEWS_SEARCH_POSTS", description: "d", parameters: {} },
		]),
	execute: () => Promise.resolve({ output: "ok" }),
	connect: () => Promise.resolve({ redirectUrl: "" }),
	listConnections: () => Promise.resolve([]),
	disconnect: () => Promise.resolve(),
};

describe("safeComposioDefs", () => {
	it("returns [] when composio is null", async () => {
		expect(await safeComposioDefs(null, "u1", [])).toEqual([]);
	});

	it("returns built tool defs when composio is present", async () => {
		const defs = await safeComposioDefs(okService, "u1", ["hackernews"]);
		expect(defs).toHaveLength(1);
		expect(defs[0]?.name).toBe("HACKERNEWS_SEARCH_POSTS");
	});

	it("swallows a composio failure and returns []", async () => {
		const boom: ComposioService = {
			listToolkits: () => Promise.resolve([]),
			listTools: () => Promise.reject(new Error("composio down")),
			execute: () => Promise.resolve({ output: "" }),
			connect: () => Promise.resolve({ redirectUrl: "" }),
			listConnections: () => Promise.resolve([]),
			disconnect: () => Promise.resolve(),
		};
		expect(await safeComposioDefs(boom, "u1", [])).toEqual([]);
	});

	it("forwards toolkits to the underlying service", async () => {
		const captured: string[][] = [];
		const service: ComposioService = {
			listToolkits: () => Promise.resolve([]),
			listTools: (_userId, toolkits) => {
				captured.push(toolkits);
				return Promise.resolve([]);
			},
			execute: () => Promise.resolve({ output: "" }),
			connect: () => Promise.resolve({ redirectUrl: "" }),
			listConnections: () => Promise.resolve([]),
			disconnect: () => Promise.resolve(),
		};
		await safeComposioDefs(service, "u1", ["hackernews"]);
		expect(captured).toEqual([["hackernews"]]);
	});
});
