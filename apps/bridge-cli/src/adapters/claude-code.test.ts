import {
	type CanUseTool,
	query,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { expect, it, vi } from "vitest";
import type { NormalizedEvent } from "../normalize/types";
import { createAsyncQueue } from "./async-queue";
import { claudeCodeAdapter } from "./claude-code";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));

interface QueryHarness {
	canUseTool: CanUseTool;
	endOutput(): void;
	interrupt: ReturnType<typeof vi.fn>;
	prompt: AsyncIterable<SDKUserMessage>;
	/** Feed an SDK message to the query's output stream. */
	yieldMessage(message: unknown): void;
}

/** Mocks `query()` so a test controls what the SDK yields and can capture the
 * streaming prompt + canUseTool the adapter wires up. */
function mockQuery(): { harness: QueryHarness } {
	const output = createAsyncQueue<unknown>();
	const interrupt = vi.fn(() => Promise.resolve());
	const harness = {} as QueryHarness;
	vi.mocked(query).mockImplementation((params) => {
		harness.prompt = params.prompt as AsyncIterable<SDKUserMessage>;
		harness.canUseTool = params.options?.canUseTool as CanUseTool;
		harness.yieldMessage = (message: unknown) => output.push(message);
		harness.endOutput = () => output.close();
		harness.interrupt = interrupt;
		const iterable = {
			[Symbol.asyncIterator]: () => output[Symbol.asyncIterator](),
			interrupt,
		};
		// The adapter only touches the async-iterable + interrupt; the rest of the
		// real Query surface is irrelevant to these tests.
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

it("normalizes an assistant message from the SDK into a reply event", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	harness.yieldMessage({
		type: "assistant",
		message: { role: "assistant", content: [{ type: "text", text: "hey" }] },
	});
	expect(await nextEvent(iterator)).toEqual({
		kind: "message",
		role: "assistant",
		text: "hey",
	});
});

it("streams a user turn into the SDK prompt on send", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");

	handle.send("do the thing");
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
