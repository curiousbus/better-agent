import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { createAgentClientFrom, type RunEvent } from "./index";

const AGENT_ID = "agent-123";
const SESSION_ID = "session-abc";

interface Calls {
	create: Array<{ agentId: string }>;
	listMessages: Array<{ sessionId: string }>;
	prompt: Array<{ sessionId: string; text: string }>;
	run: Array<{ sessionId: string; text: string }>;
}

function stubClient(events: RunEvent[] = []) {
	const calls: Calls = { create: [], run: [], prompt: [], listMessages: [] };
	const client = {
		sessions: {
			create(input: { agentId: string }) {
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
			prompt(input: { sessionId: string; text: string }) {
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
				return Promise.resolve([{ message: { id: "m1" }, parts: [] }]);
			},
		},
	} as unknown as RouterClient<AppRouter>;
	return { client, calls };
}

describe("createAgentClientFrom — createSession and run", () => {
	it("createSession binds the configured agentId and returns the new sessionId", async () => {
		const { client, calls } = stubClient();
		const sdk = createAgentClientFrom(client, AGENT_ID);
		expect(await sdk.createSession()).toEqual({ sessionId: SESSION_ID });
		expect(calls.create).toEqual([{ agentId: AGENT_ID }]);
	});

	it("run auto-creates a session when none is given, then runs with it", async () => {
		const { client, calls } = stubClient();
		const sdk = createAgentClientFrom(client, AGENT_ID);
		const message = await sdk.run("hi");
		expect(calls.create).toEqual([{ agentId: AGENT_ID }]);
		expect(calls.run).toEqual([{ sessionId: SESSION_ID, text: "hi" }]);
		expect(message).toMatchObject({ role: "assistant", status: "complete" });
	});

	it("run reuses an explicit sessionId without creating one", async () => {
		const { client, calls } = stubClient();
		const sdk = createAgentClientFrom(client, AGENT_ID);
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
		const sdk = createAgentClientFrom(client, AGENT_ID);
		const received: RunEvent[] = [];
		for await (const event of sdk.stream("hi", { sessionId: "s1" })) {
			received.push(event);
		}
		expect(received).toEqual(events);
		expect(calls.prompt).toEqual([{ sessionId: "s1", text: "hi" }]);
	});

	it("stream auto-creates a session when none is given", async () => {
		const { client, calls } = stubClient([]);
		const sdk = createAgentClientFrom(client, AGENT_ID);
		const received: RunEvent[] = [];
		for await (const event of sdk.stream("hi")) {
			received.push(event);
		}
		expect(received).toEqual([]);
		expect(calls.create).toEqual([{ agentId: AGENT_ID }]);
		expect(calls.prompt).toEqual([{ sessionId: SESSION_ID, text: "hi" }]);
	});

	it("listMessages passes the sessionId through", async () => {
		const { client, calls } = stubClient();
		const sdk = createAgentClientFrom(client, AGENT_ID);
		const history = await sdk.listMessages("s9");
		expect(calls.listMessages).toEqual([{ sessionId: "s9" }]);
		expect(history.length).toBe(1);
	});
});
