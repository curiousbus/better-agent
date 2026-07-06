import { describe, expect, it } from "vitest";
import { normalizeOpencode } from "./opencode";

describe("normalizeOpencode - message chunks", () => {
	it("maps an agent_message_chunk to an accumulating output event", () => {
		const events = normalizeOpencode({
			method: "session/update",
			params: {
				sessionId: "s1",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "hi" },
				},
			},
		});
		// output (not message) so the UI accumulates chunks into one bubble,
		// instead of rendering each streamed word as its own message.
		expect(events).toEqual([{ kind: "output", text: "hi", reasoning: false }]);
	});

	it("marks agent_thought_chunk as reasoning output", () => {
		const events = normalizeOpencode({
			method: "session/update",
			params: {
				update: {
					sessionUpdate: "agent_thought_chunk",
					content: { type: "text", text: "hmm" },
				},
			},
		});
		expect(events).toEqual([{ kind: "output", text: "hmm", reasoning: true }]);
	});
});

describe("normalizeOpencode - tool calls", () => {
	it("maps a tool_call to a started tool event", () => {
		const events = normalizeOpencode({
			method: "session/update",
			params: {
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "call_1",
					title: "Read file",
					rawInput: { path: "a.ts" },
				},
			},
		});
		expect(events).toEqual([
			{
				kind: "tool",
				id: "call_1",
				name: "Read file",
				status: "started",
				input: { path: "a.ts" },
				output: undefined,
			},
		]);
	});

	it("maps a tool_call_update with an explicit status", () => {
		const events = normalizeOpencode({
			method: "session/update",
			params: {
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: "call_1",
					status: "failed",
					content: "error text",
				},
			},
		});
		expect(events[0]).toMatchObject({ status: "failed", output: "error text" });
	});
});

describe("normalizeOpencode - plan and edge cases", () => {
	it("maps a plan update to a status event", () => {
		const events = normalizeOpencode({
			method: "session/update",
			params: {
				update: { sessionUpdate: "plan", entries: [{ content: "step 1" }] },
			},
		});
		expect(events).toEqual([
			{ kind: "status", status: "plan", detail: [{ content: "step 1" }] },
		]);
	});

	it("ignores notifications that aren't session/update", () => {
		expect(
			normalizeOpencode({ method: "session/created", params: {} })
		).toEqual([]);
	});
});
