import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { createUserSessionClientFrom } from "./internal";
import type { ClientToolDef, RunEvent } from "./types";

const SESSION_ID = "sess-1";

function* iterate(events: RunEvent[]): Generator<RunEvent> {
	for (const event of events) {
		yield event;
	}
}

interface PromptCall {
	tools?: {
		description: string;
		name: string;
		parameters: Record<string, unknown>;
	}[];
}

interface SubmitCall {
	isError: boolean;
	result: string;
}

function makeClient(events: RunEvent[]) {
	const promptCalls: PromptCall[] = [];
	const submitted: SubmitCall[] = [];
	const userSessions = {
		create: () => Promise.resolve({ id: SESSION_ID }),
		prompt: (input: PromptCall) => {
			promptCalls.push(input);
			return Promise.resolve(iterate(events));
		},
		submitToolResult: (input: SubmitCall) => {
			submitted.push(input);
			return Promise.resolve(undefined);
		},
	};
	const client = { userSessions } as unknown as RouterClient<AppRouter>;
	return { client, promptCalls, submitted };
}

it("user-session stream forwards tool defs and dispatches tool-calls", async () => {
	const events: RunEvent[] = [
		{ type: "tool-call", callId: "c1", toolName: "echo", args: { x: 1 } },
		{ type: "done", usage: null, finishReason: "stop" },
	];
	const { client, promptCalls, submitted } = makeClient(events);
	const sdk = createUserSessionClientFrom(client, "agent-1");
	const tool: ClientToolDef = {
		name: "echo",
		description: "echo",
		parameters: {},
		execute: (args) => Promise.resolve(JSON.stringify(args)),
	};
	const seen: string[] = [];
	for await (const event of sdk.stream("hi", {
		sessionId: SESSION_ID,
		tools: [tool],
	})) {
		seen.push(event.type);
	}
	expect(promptCalls[0]?.tools).toEqual([
		{ name: "echo", description: "echo", parameters: {} },
	]);
	expect(submitted[0]?.result).toBe(JSON.stringify({ x: 1 }));
	expect(seen).toContain("tool-call");
});
