import { expect, it, vi } from "vitest";
import type { NormalizedEvent } from "../normalize/types";
import { createAsyncQueue } from "./async-queue";
import { claudeCodeAdapter } from "./claude-code";
import type { ProcessIo } from "./process-io";
import { spawnProcessIo } from "./process-io";

vi.mock("./process-io", () => ({ spawnProcessIo: vi.fn() }));

const neverEndingLines: AsyncIterable<string> = {
	[Symbol.asyncIterator]() {
		return {
			next: () => new Promise<IteratorResult<string>>(() => undefined),
		};
	},
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface FakeProc {
	args: string[];
	/** Close stdout — the one-shot turn ends (claude exited). */
	end(): void;
	io: ProcessIo;
	pushLine(line: string): void;
	writeLine: ReturnType<typeof vi.fn>;
}

/** Makes `spawnProcessIo` hand back a fresh fake process per call (claude-code
 * now spawns one `claude -p` per turn), and records each so a test can drive it. */
function mockSpawns(): { spawned: FakeProc[] } {
	const spawned: FakeProc[] = [];
	vi.mocked(spawnProcessIo).mockImplementation((_cmd, args) => {
		const lines = createAsyncQueue<string>();
		const writeLine = vi.fn();
		const io: ProcessIo = {
			child: {} as ProcessIo["child"],
			lines,
			onExit: () => undefined,
			stderrLines: neverEndingLines,
			stop: vi.fn(() => lines.close()),
			writeLine,
		};
		spawned.push({
			args: args as string[],
			io,
			pushLine: (line: string) => lines.push(line),
			end: () => lines.close(),
			writeLine,
		});
		return Promise.resolve(io);
	});
	return { spawned };
}

async function nextEvent(
	iterator: AsyncIterator<NormalizedEvent>
): Promise<NormalizedEvent | undefined> {
	const { value, done } = await iterator.next();
	return done ? undefined : value;
}

it("spawns `claude -p <prompt>` on send and streams the reply", async () => {
	const { spawned } = mockSpawns();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	handle.send("say hi");
	await flush();
	expect(spawned).toHaveLength(1);
	expect(spawned[0]?.args).toEqual([
		"-p",
		"say hi",
		"--output-format",
		"stream-json",
		"--verbose",
		"--permission-prompt-tool",
		"stdio",
	]);

	spawned[0]?.pushLine(
		JSON.stringify({
			type: "assistant",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "hey" }],
			},
		})
	);
	expect(await nextEvent(iterator)).toEqual({
		kind: "message",
		role: "assistant",
		text: "hey",
	});
});

it("resumes the session on the next turn with --resume <session_id>", async () => {
	const { spawned } = mockSpawns();
	const handle = await claudeCodeAdapter.start("/tmp/project");

	handle.send("first");
	await flush();
	spawned[0]?.pushLine(
		JSON.stringify({ type: "system", subtype: "init", session_id: "sess-1" })
	);
	await flush();
	spawned[0]?.end();
	await flush();

	handle.send("second");
	await flush();
	expect(spawned).toHaveLength(2);
	expect(spawned[1]?.args).toContain("--resume");
	expect(spawned[1]?.args).toContain("sess-1");
});

it("runs turns one at a time (a mid-turn command waits)", async () => {
	const { spawned } = mockSpawns();
	const handle = await claudeCodeAdapter.start("/tmp/project");

	handle.send("one");
	handle.send("two");
	await flush();
	// Only the first turn has spawned; the second is queued.
	expect(spawned).toHaveLength(1);

	spawned[0]?.end();
	await flush();
	expect(spawned).toHaveLength(2);
	expect(spawned[1]?.args).toContain("two");
});

it("surfaces a can_use_tool control request and replies over the turn's stdin", async () => {
	const { spawned } = mockSpawns();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	handle.send("run a tool");
	await flush();
	spawned[0]?.pushLine(
		JSON.stringify({
			type: "control_request",
			request_id: "req_1",
			request: {
				subtype: "can_use_tool",
				tool_name: "Bash",
				input: { command: "ls" },
			},
		})
	);
	const event = await nextEvent(iterator);
	expect(event).toMatchObject({ kind: "approval", requestId: "req_1" });

	handle.answerApproval("req_1", "allow");
	expect(spawned[0]?.writeLine).toHaveBeenCalledExactlyOnceWith(
		JSON.stringify({
			type: "control_response",
			request_id: "req_1",
			response: { subtype: "success", response: { behavior: "allow" } },
		})
	);
});

it("stop() closes the events stream", async () => {
	mockSpawns();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	handle.stop();
	expect((await iterator.next()).done).toBe(true);
});

it("emits a status warning instead of replying for an unknown requestId", async () => {
	mockSpawns();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	handle.answerApproval("does-not-exist", "allow");
	expect(await nextEvent(iterator)).toEqual({
		detail: { requestId: "does-not-exist" },
		kind: "status",
		status: "approval_unknown",
	});
});
