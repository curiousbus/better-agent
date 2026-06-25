import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./use-chat";
import { streamPrompt, toChatMessage } from "./use-chat";

function fakeStream(events: unknown[]) {
	return {
		// biome-ignore lint/suspicious/useAwait: test async generator
		async *stream() {
			for (const e of events) {
				yield e;
			}
		},
	} as unknown as import("@better-agent/client").AgentClient;
}

it("streams tool-call then tool-result into the draft assistant", async () => {
	const drafts: ChatMessage[][] = [];
	const user: ChatMessage = {
		id: "u",
		role: "user",
		text: "hi",
		reasoning: "",
		status: "complete",
		tools: [],
	};
	const assistant: ChatMessage = {
		id: "a",
		role: "assistant",
		text: "",
		reasoning: "",
		status: "streaming",
		tools: [],
	};
	await streamPrompt({
		agentClient: fakeStream([
			{ type: "tool-call", callId: "c1", toolName: "search", args: { q: "x" } },
			{ type: "tool-result", callId: "c1", result: "ok", isError: false },
			{ type: "text-delta", delta: "answer" },
		]),
		assistant,
		user,
		sessionId: "s",
		text: "hi",
		signal: new AbortController().signal,
		setDraft: (m) => drafts.push(m),
	});
	const last = drafts.at(-1)?.[1];
	expect(last?.tools).toHaveLength(1);
	expect(last?.tools[0]).toMatchObject({ callId: "c1", status: "complete" });
});

it("captures the error event message as errorText", async () => {
	const drafts: ChatMessage[][] = [];
	const user: ChatMessage = {
		id: "u",
		role: "user",
		text: "hi",
		reasoning: "",
		status: "complete",
		tools: [],
	};
	const assistant: ChatMessage = {
		id: "a",
		role: "assistant",
		text: "",
		reasoning: "",
		status: "streaming",
		tools: [],
	};
	await streamPrompt({
		agentClient: fakeStream([{ type: "error", message: "rate limited" }]),
		assistant,
		user,
		sessionId: "s",
		text: "hi",
		signal: new AbortController().signal,
		setDraft: (m) => drafts.push(m),
	});
	const last = drafts.at(-1)?.[1];
	expect(last?.status).toBe("error");
	expect(last?.errorText).toBe("rate limited");
});

function part(over: Record<string, unknown>) {
	return {
		id: "p",
		messageId: "m",
		seq: 0,
		status: "complete",
		createdAt: new Date(),
		updatedAt: new Date(),
		...over,
	};
}

function rowWithToolPair() {
	return {
		message: { id: "m1", role: "assistant", status: "complete" },
		parts: [
			part({ type: "reasoning", content: { text: "think" } }),
			part({
				type: "tool-call",
				seq: 1,
				content: { callId: "c1", toolName: "search", args: { q: "x" } },
			}),
			part({
				type: "tool-result",
				seq: 2,
				content: { callId: "c1", result: { hits: 3 }, isError: false },
			}),
			part({ type: "text", seq: 3, content: { text: "done" } }),
		],
	} as unknown as Parameters<typeof toChatMessage>[0];
}

function rowWithRunningTool() {
	return {
		message: { id: "m2", role: "assistant", status: "streaming" },
		parts: [
			part({
				type: "tool-call",
				content: { callId: "c9", toolName: "fetch", args: {} },
			}),
		],
	} as unknown as Parameters<typeof toChatMessage>[0];
}

function rowWithErroredTool() {
	return {
		message: { id: "m3", role: "assistant", status: "complete" },
		parts: [
			part({
				type: "tool-call",
				content: { callId: "c2", toolName: "x", args: {} },
			}),
			part({
				type: "tool-result",
				seq: 1,
				content: { callId: "c2", result: "boom", isError: true },
			}),
		],
	} as unknown as Parameters<typeof toChatMessage>[0];
}

describe("toChatMessage", () => {
	it("pairs tool-call and tool-result parts by callId into tools[]", () => {
		const msg = toChatMessage(rowWithToolPair());
		expect(msg.text).toBe("done");
		expect(msg.reasoning).toBe("think");
		expect(msg.tools).toHaveLength(1);
		expect(msg.tools[0]).toMatchObject({
			callId: "c1",
			toolName: "search",
			isError: false,
			status: "complete",
		});
		expect(msg.tools[0]?.result).toEqual({ hits: 3 });
	});

	it("marks a tool-call without a result as running", () => {
		const msg = toChatMessage(rowWithRunningTool());
		expect(msg.tools[0]).toMatchObject({ callId: "c9", status: "running" });
	});

	it("marks an errored tool-result as status error", () => {
		const msg = toChatMessage(rowWithErroredTool());
		expect(msg.tools[0]).toMatchObject({ status: "error", isError: true });
	});
});
