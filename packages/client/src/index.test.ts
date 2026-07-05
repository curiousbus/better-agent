import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import {
	createAgentClientFrom,
	createUserSessionClientFrom,
	dispatchToolCall,
} from "./internal";
import type { ClientToolDef, RunEvent } from "./types";

const SESSION_ID = "session-abc";

interface Calls {
	create: Record<string, never>[];
	listMessages: { sessionId: string }[];
	prompt: { sessionId: string; text: string; tools?: unknown }[];
	run: { sessionId: string; text: string }[];
	submitToolResult: {
		callId: string;
		isError: boolean;
		result: string;
		sessionId: string;
	}[];
}

function makeCalls(): Calls {
	return {
		create: [],
		run: [],
		prompt: [],
		listMessages: [],
		submitToolResult: [],
	};
}

function makeSessionsStub(calls: Calls, events: RunEvent[]) {
	return {
		create(input: Record<string, never>) {
			calls.create.push(input);
			return Promise.resolve({ id: SESSION_ID });
		},
		run(input: { sessionId: string; text: string }) {
			calls.run.push(input);
			return Promise.resolve({
				id: "m1",
				role: "assistant",
				status: "complete",
			});
		},
		prompt(input: { sessionId: string; text: string; tools?: unknown }) {
			calls.prompt.push(input);
			function* gen() {
				for (const event of events) {
					yield event;
				}
			}
			return Promise.resolve(gen());
		},
		listMessages(input: { sessionId: string }) {
			calls.listMessages.push(input);
			return Promise.resolve([
				{
					message: { id: "m1", role: "assistant", status: "complete" },
					parts: [],
				},
			]);
		},
		submitToolResult(input: {
			sessionId: string;
			callId: string;
			result: string;
			isError: boolean;
		}) {
			calls.submitToolResult.push(input);
			return Promise.resolve({ ok: true });
		},
	};
}

function stubClient(events: RunEvent[] = []) {
	const calls = makeCalls();
	const client = {
		sessions: makeSessionsStub(calls, events),
	} as unknown as RouterClient<AppRouter>;
	return { client, calls };
}

describe("createAgentClientFrom — createSession and run", () => {
	it("createSession creates a token-scoped session and returns the new sessionId", async () => {
		const { client, calls } = stubClient();
		const sdk = createAgentClientFrom(client);
		expect(await sdk.createSession()).toEqual({ sessionId: SESSION_ID });
		expect(calls.create).toEqual([{}]);
	});

	it("run auto-creates a session when none is given, then runs with it", async () => {
		const { client, calls } = stubClient();
		const sdk = createAgentClientFrom(client);
		const message = await sdk.run("hi");
		expect(calls.create).toEqual([{}]);
		expect(calls.run).toEqual([{ sessionId: SESSION_ID, text: "hi" }]);
		expect(message).toMatchObject({ role: "assistant", status: "complete" });
	});

	it("run reuses an explicit sessionId without creating one", async () => {
		const { client, calls } = stubClient();
		const sdk = createAgentClientFrom(client);
		await sdk.run("hi", { sessionId: "explicit" });
		expect(calls.create).toEqual([]);
		expect(calls.run).toEqual([{ sessionId: "explicit", text: "hi" }]);
	});
});

describe("createAgentClientFrom — stream and listMessages", () => {
	it("stream forwards run events from prompt for an explicit session", async () => {
		const events = [
			{ type: "message-start", messageId: "m1" },
			{ type: "text-delta", delta: "hi" },
			{ type: "done", usage: null, finishReason: "stop" },
		] as RunEvent[];
		const { client, calls } = stubClient(events);
		const sdk = createAgentClientFrom(client);
		const received: RunEvent[] = [];
		for await (const event of sdk.stream("hi", { sessionId: "s1" })) {
			received.push(event);
		}
		expect(received).toEqual(events);
		expect(calls.prompt).toEqual([
			{ sessionId: "s1", text: "hi", tools: undefined },
		]);
	});

	it("stream auto-creates a session when none is given", async () => {
		const { client, calls } = stubClient([]);
		const sdk = createAgentClientFrom(client);
		const received: RunEvent[] = [];
		for await (const event of sdk.stream("hi")) {
			received.push(event);
		}
		expect(received).toEqual([]);
		expect(calls.create).toEqual([{}]);
		expect(calls.prompt).toEqual([
			{ sessionId: SESSION_ID, text: "hi", tools: undefined },
		]);
	});

	it("listMessages passes the sessionId through", async () => {
		const { client, calls } = stubClient();
		const sdk = createAgentClientFrom(client);
		const history = await sdk.listMessages("s9");
		expect(calls.listMessages).toEqual([{ sessionId: "s9" }]);
		expect(history.length).toBe(1);
	});
});

describe("createAgentClientFrom — stream with tools", () => {
	it("passes stripped tool defs to prompt and dispatches tool-call events", async () => {
		const events = [
			{ type: "tool-call", callId: "c1", toolName: "echo", args: { v: 1 } },
			{ type: "done", usage: null, finishReason: "tool_use" },
		] as RunEvent[];
		const { client, calls } = stubClient(events);
		const sdk = createAgentClientFrom(client);
		const tools: ClientToolDef[] = [
			{
				name: "echo",
				description: "echoes args",
				parameters: { type: "object" },
				execute: (a) => Promise.resolve(`r:${JSON.stringify(a)}`),
			},
		];
		const received: RunEvent[] = [];
		for await (const event of sdk.stream("hi", { sessionId: "s1", tools })) {
			received.push(event);
		}
		expect(received[0]).toMatchObject({ type: "tool-call", callId: "c1" });
		expect(calls.prompt[0]?.tools).toEqual([
			{
				name: "echo",
				description: "echoes args",
				parameters: { type: "object" },
			},
		]);
		expect(calls.submitToolResult[0]).toEqual({
			sessionId: "s1",
			callId: "c1",
			result: 'r:{"v":1}',
			isError: false,
		});
	});
});

const echoTool: ClientToolDef = {
	name: "echo",
	description: "",
	parameters: {},
	execute: (a) => Promise.resolve(`r:${JSON.stringify(a)}`),
};

const boomTool: ClientToolDef = {
	name: "boom",
	description: "",
	parameters: {},
	execute: () => Promise.reject(new Error("kaboom")),
};

describe("dispatchToolCall", () => {
	it("runs the matching local tool and submits its result", async () => {
		const submitted: unknown[] = [];
		await dispatchToolCall(
			[echoTool],
			{ callId: "c1", toolName: "echo", args: { v: 1 } },
			(r) => {
				submitted.push(r);
				return Promise.resolve();
			}
		);
		expect(submitted[0]).toEqual({
			callId: "c1",
			result: 'r:{"v":1}',
			isError: false,
		});
	});

	it("submits isError when the tool is missing", async () => {
		const submitted: { isError: boolean }[] = [];
		await dispatchToolCall(
			[],
			{ callId: "c1", toolName: "nope", args: {} },
			(r) => {
				submitted.push(r as { isError: boolean });
				return Promise.resolve();
			}
		);
		expect(submitted[0]?.isError).toBe(true);
	});

	it("submits isError when the tool execute throws", async () => {
		const submitted: { isError: boolean; result: string }[] = [];
		await dispatchToolCall(
			[boomTool],
			{ callId: "c2", toolName: "boom", args: {} },
			(r) => {
				submitted.push(r as { isError: boolean; result: string });
				return Promise.resolve();
			}
		);
		expect(submitted[0]?.isError).toBe(true);
		expect(submitted[0]?.result).toBe("kaboom");
	});
});

describe("createUserSessionClientFrom — user-plane adapter", () => {
	it("user-plane client creates sessions via userSessions.create with the bound agentId", async () => {
		const calls: { create?: unknown } = {};
		const fake = {
			userSessions: {
				create: (input: { agentId: string }) => {
					calls.create = input;
					return Promise.resolve({ id: "s1" });
				},
				listMessages: () => Promise.resolve([]),
				run: () => Promise.resolve({}),
				prompt: () =>
					(async function* () {
						/* no events */
					})(),
			},
		} as never;
		const client = createUserSessionClientFrom(fake, "agent-1");
		const s = await client.createSession();
		expect(s.sessionId).toBe("s1");
		expect(calls.create).toEqual({ agentId: "agent-1" });
	});
});
