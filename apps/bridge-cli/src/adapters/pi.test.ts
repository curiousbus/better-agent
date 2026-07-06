import { describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "./async-queue";
import { piAdapter } from "./pi";
import type { ProcessExitInfo, ProcessIo } from "./process-io";
import { spawnProcessIo } from "./process-io";

vi.mock("./process-io", () => ({ spawnProcessIo: vi.fn() }));

/** An async iterable that never yields — stands in for stdout/stderr on a
 * process that's still running. */
const neverEndingLines: AsyncIterable<string> = {
	[Symbol.asyncIterator]() {
		return {
			next: () => new Promise<IteratorResult<string>>(() => undefined),
		};
	},
};

/** A fake `ProcessIo` whose exit can be triggered, and whose stdout lines can
 * be fed, on demand by the test, standing in for the real `pi --mode rpc`
 * child process pi.ts spawns. */
function createFakeProcessIo(): {
	io: ProcessIo;
	pushLine(line: string): void;
	triggerExit(info: ProcessExitInfo): void;
} {
	const exitHandlers: Array<(info: ProcessExitInfo) => void> = [];
	const lines = createAsyncQueue<string>();
	return {
		io: {
			child: {} as ProcessIo["child"],
			lines,
			onExit: (handler) => exitHandlers.push(handler),
			stderrLines: neverEndingLines,
			stop: vi.fn(),
			writeLine: vi.fn(),
		},
		pushLine(line: string): void {
			lines.push(line);
		},
		triggerExit(info: ProcessExitInfo): void {
			for (const handler of exitHandlers) {
				handler(info);
			}
		},
	};
}

describe("piAdapter - process lifecycle", () => {
	it("pushes an agent_exited status, then closes `events`, once the process exits on its own", async () => {
		const { io, triggerExit } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		triggerExit({ code: 1, signal: null });

		const { value: statusEvent } = await iterator.next();
		expect(statusEvent).toEqual({ kind: "status", status: "agent_exited" });

		const result = await iterator.next();
		expect(result.done).toBe(true);
	});

	it("spawns `pi --mode rpc` in the given directory", async () => {
		const { io } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		await piAdapter.start("/tmp/project");

		expect(spawnProcessIo).toHaveBeenLastCalledWith(
			"pi",
			["--mode", "rpc"],
			"/tmp/project"
		);
	});
});

describe("piAdapter - send()", () => {
	it("writes a prompt command frame to stdin", async () => {
		const { io } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		handle.send("hello");

		expect(io.writeLine).toHaveBeenCalledExactlyOnceWith(
			JSON.stringify({ type: "prompt", message: "hello" })
		);
	});
});

describe("piAdapter - stdout/stderr relay", () => {
	it("relays parsed stdout lines as normalized events", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		pushLine(
			JSON.stringify({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", delta: "hi" },
			})
		);

		const { value: event } = await iterator.next();
		expect(event).toEqual({ kind: "output", text: "hi" });
	});

	it("relays stderr lines as error events", async () => {
		const io: ProcessIo = {
			child: {} as ProcessIo["child"],
			lines: createAsyncQueue<string>(),
			onExit: vi.fn(),
			stderrLines: (() => {
				const queue = createAsyncQueue<string>();
				queue.push("pi: something went wrong");
				return queue;
			})(),
			stop: vi.fn(),
			writeLine: vi.fn(),
		};
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const { value: event } = await handle.events[Symbol.asyncIterator]().next();
		expect(event).toEqual({
			kind: "error",
			message: "pi: something went wrong",
		});
	});
});

describe("piAdapter - answerApproval has no protocol to wire into", () => {
	it("always emits a status warning: pi has no approval requests to answer", async () => {
		const { io } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);
		const handle = await piAdapter.start("/tmp/project");

		handle.answerApproval("anything", "allow");

		const { value: event } = await handle.events[Symbol.asyncIterator]().next();
		expect(event).toEqual({
			detail: { requestId: "anything" },
			kind: "status",
			status: "approval_unknown",
		});
		expect(io.writeLine).not.toHaveBeenCalled();
	});
});

describe("piAdapter - stop()", () => {
	it("stops the process and closes `events`", async () => {
		const { io } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);
		const handle = await piAdapter.start("/tmp/project");

		handle.stop();

		expect(io.stop).toHaveBeenCalledTimes(1);
		const result = await handle.events[Symbol.asyncIterator]().next();
		expect(result.done).toBe(true);
	});
});
