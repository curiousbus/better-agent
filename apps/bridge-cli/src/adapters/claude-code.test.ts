import {
	type CanUseTool,
	listSessions,
	query,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { expect, it, vi } from "vitest";
import type { NormalizedEvent } from "../normalize/types";
import { createAsyncQueue } from "./async-queue";
import { claudeCodeAdapter } from "./claude-code";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	listSessions: vi.fn(),
}));

interface QueryHarness {
	canUseTool: CanUseTool;
	endOutput(): void;
	interrupt: ReturnType<typeof vi.fn>;
	prompt: AsyncIterable<SDKUserMessage>;
	setModel: ReturnType<typeof vi.fn>;
	setPermissionMode: ReturnType<typeof vi.fn>;
	/** Feed an SDK message to the query's output stream. */
	yieldMessage(message: unknown): void;
}

/** Mocks `query()` so a test controls what the SDK yields and can capture the
 * streaming prompt + canUseTool the adapter wires up. */
function mockQuery(): { harness: QueryHarness } {
	const output = createAsyncQueue<unknown>();
	const interrupt = vi.fn(() => Promise.resolve());
	const setModel = vi.fn(() => Promise.resolve());
	const setPermissionMode = vi.fn(() => Promise.resolve());
	const harness = {} as QueryHarness;
	vi.mocked(query).mockImplementation((params) => {
		harness.prompt = params.prompt as AsyncIterable<SDKUserMessage>;
		harness.canUseTool = params.options?.canUseTool as CanUseTool;
		harness.yieldMessage = (message: unknown) => output.push(message);
		harness.endOutput = () => output.close();
		harness.interrupt = interrupt;
		harness.setModel = setModel;
		harness.setPermissionMode = setPermissionMode;
		const iterable = {
			[Symbol.asyncIterator]: () => output[Symbol.asyncIterator](),
			interrupt,
			setModel,
			setPermissionMode,
		};
		// The adapter only touches the async-iterable + interrupt/setModel/
		// setPermissionMode; the rest of the real Query surface is irrelevant to
		// these tests.
		return iterable as unknown as ReturnType<typeof query>;
	});
	return { harness };
}

async function nextEvent(
	iterator: AsyncIterator<NormalizedEvent>
): Promise<NormalizedEvent | undefined> {
	const { value, done } = await iterator.next();
	return done ? undefined : value;
}

it("streams the reply as output once and drops the duplicate final text block", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	// The response text streams live via stream_event text_delta...
	harness.yieldMessage({
		type: "stream_event",
		event: {
			type: "content_block_delta",
			delta: { type: "text_delta", text: "hey" },
		},
	});
	expect(await nextEvent(iterator)).toEqual({ kind: "output", text: "hey" });

	// ...and the final assistant message repeats it plus a tool_use: the text
	// block must be dropped (already streamed above) while tool_use survives.
	harness.yieldMessage({
		type: "assistant",
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: "hey" },
				{ type: "tool_use", id: "toolu_1", name: "Read", input: {} },
			],
		},
	});
	expect(await nextEvent(iterator)).toMatchObject({
		kind: "tool",
		id: "toolu_1",
	});
});

it("normalizes a thinking_delta stream_event into a reasoning-flagged output event", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	harness.yieldMessage({
		type: "stream_event",
		event: {
			type: "content_block_delta",
			delta: { type: "thinking_delta", thinking: "pondering…" },
		},
	});
	expect(await nextEvent(iterator)).toEqual({
		kind: "output",
		text: "pondering…",
		reasoning: true,
	});
});

it("persists the user's turn AND forwards it to the SDK on send", async () => {
	// The event keeps the user's input in history on reload; the prompt drives the agent.
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	handle.send("do the thing");
	expect(await iterator.next()).toEqual({
		done: false,
		value: { kind: "message", role: "user", text: "do the thing" },
	});
	const { value } = await harness.prompt[Symbol.asyncIterator]().next();
	expect(value).toEqual({
		type: "user",
		message: { role: "user", content: "do the thing" },
		parent_tool_use_id: null,
	});
});

it("routes a tool permission request to an approval event and resolves allow", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	const options = { toolUseID: "req_1" } as Parameters<CanUseTool>[2];
	const decision = harness.canUseTool("Bash", { command: "ls" }, options);
	expect(await nextEvent(iterator)).toMatchObject({
		kind: "approval",
		requestId: "req_1",
		title: "Use Bash?",
	});

	handle.answerApproval("req_1", "allow");
	const result = await decision;
	expect(result?.behavior).toBe("allow");
});

it("resolves deny when the user rejects the tool", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	const options = { toolUseID: "req_2" } as Parameters<CanUseTool>[2];
	const decision = harness.canUseTool("Bash", { command: "rm -rf" }, options);
	await nextEvent(iterator);

	handle.answerApproval("req_2", "deny");
	const result = await decision;
	expect(result?.behavior).toBe("deny");
});

it("stop() interrupts the session and closes the events stream", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	handle.stop();
	expect(harness.interrupt).toHaveBeenCalledTimes(1);
	expect((await iterator.next()).done).toBe(true);
});

it("interrupt() calls session.interrupt() but leaves the events stream open", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");

	handle.interrupt?.();
	expect(harness.interrupt).toHaveBeenCalledTimes(1);
	handle.send("still here?");
	const { value } = await harness.prompt[Symbol.asyncIterator]().next();
	expect(value).toMatchObject({
		message: { content: "still here?" },
	});
});

it("setModel() calls session.setModel() with the requested model", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");

	handle.setModel?.("opus");
	expect(harness.setModel).toHaveBeenCalledExactlyOnceWith("opus");
});

it("setPermissionMode() calls session.setPermissionMode() for a recognized mode", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");

	handle.setPermissionMode?.("plan");
	expect(harness.setPermissionMode).toHaveBeenCalledExactlyOnceWith("plan");
});

it("setPermissionMode() ignores an unrecognized mode instead of forwarding it", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");

	handle.setPermissionMode?.("not-a-real-mode");
	expect(harness.setPermissionMode).not.toHaveBeenCalled();
});

it("start(dir, { resume }) passes the resume id through to query()'s options", async () => {
	mockQuery();
	await claudeCodeAdapter.start("/tmp/project", { resume: "claude-session-1" });

	expect(vi.mocked(query)).toHaveBeenLastCalledWith(
		expect.objectContaining({
			options: expect.objectContaining({ resume: "claude-session-1" }),
		})
	);
});

it("start(dir) without resume leaves options.resume undefined", async () => {
	mockQuery();
	await claudeCodeAdapter.start("/tmp/project");

	expect(vi.mocked(query)).toHaveBeenLastCalledWith(
		expect.objectContaining({
			options: expect.objectContaining({ resume: undefined }),
		})
	);
});

it("listSessions() pushes a session_list status event with the fetched sessions", async () => {
	mockQuery();
	vi.mocked(listSessions).mockResolvedValue([
		{
			sessionId: "sess-1",
			summary: "Fix the login bug",
			lastModified: 1_700_000_000_000,
			gitBranch: "main",
			cwd: "/tmp/project",
		},
		{
			sessionId: "sess-2",
			summary: "first prompt fallback",
			customTitle: "My renamed session",
			lastModified: 1_700_000_001_000,
		},
	]);
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	handle.listSessions?.();

	expect(await nextEvent(iterator)).toEqual({
		kind: "status",
		status: "session_list",
		detail: {
			sessions: [
				{
					id: "sess-1",
					title: "Fix the login bug",
					lastModified: 1_700_000_000_000,
					gitBranch: "main",
					cwd: "/tmp/project",
				},
				{
					id: "sess-2",
					title: "My renamed session",
					lastModified: 1_700_000_001_000,
					gitBranch: undefined,
					cwd: undefined,
				},
			],
		},
	});
	expect(vi.mocked(listSessions)).toHaveBeenLastCalledWith({
		dir: "/tmp/project",
	});
});

it("listSessions() pushes an error event when the SDK call rejects", async () => {
	mockQuery();
	vi.mocked(listSessions).mockRejectedValue(new Error("no claude dir"));
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	handle.listSessions?.();

	expect(await nextEvent(iterator)).toEqual({
		kind: "error",
		message: "Failed to list past claude sessions",
		detail: "no claude dir",
	});
});
