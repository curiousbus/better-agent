import { describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "./async-queue";
import { claudeCodeAdapter } from "./claude-code";
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
 * be fed, on demand by the test, standing in for the real child process
 * claude-code.ts spawns. */
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

describe("claudeCodeAdapter", () => {
	it("pushes an agent_exited status, then closes `events`, once the process exits on its own", async () => {
		const { io, triggerExit } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await claudeCodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		// Nothing has happened yet: the agent is still "running". Held onto
		// (rather than discarded) since the queue resolves this same call once
		// the process exits below — a fresh `iterator.next()` call afterwards
		// would instead see whatever's pushed *after* this one is resolved.
		const next = iterator.next();
		const pending = Promise.race([
			next.then(() => "settled"),
			Promise.resolve().then(() => "still-pending"),
		]);
		expect(await pending).toBe("still-pending");

		// The process crashes (or simply exits) without anyone calling stop().
		triggerExit({ code: 1, signal: null });

		const { value: statusEvent } = await next;
		expect(statusEvent).toEqual({ kind: "status", status: "agent_exited" });

		const result = await iterator.next();
		expect(result.done).toBe(true);
	});
});

describe("claudeCodeAdapter - approvals - can_use_tool", () => {
	it("surfaces a can_use_tool control_request and replies via answerApproval", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await claudeCodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		pushLine(
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

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			detail: JSON.stringify({ command: "ls" }),
			kind: "approval",
			options: [
				{ id: "allow", label: "Allow" },
				{ id: "deny", label: "Deny" },
			],
			requestId: "req_1",
			title: "Use Bash?",
		});

		handle.answerApproval("req_1", "allow");
		expect(io.writeLine).toHaveBeenCalledExactlyOnceWith(
			JSON.stringify({
				type: "control_response",
				request_id: "req_1",
				response: { subtype: "success", response: { behavior: "allow" } },
			})
		);
	});
});

describe("claudeCodeAdapter - approvals - unknown requestId", () => {
	it("emits a status warning instead of replying for an unknown requestId", async () => {
		const { io } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);
		const handle = await claudeCodeAdapter.start("/tmp/project");

		handle.answerApproval("does-not-exist", "allow");

		const { value: event } = await handle.events[Symbol.asyncIterator]().next();
		expect(event).toEqual({
			detail: { requestId: "does-not-exist" },
			kind: "status",
			status: "approval_unknown",
		});
		expect(io.writeLine).not.toHaveBeenCalled();
	});
});
