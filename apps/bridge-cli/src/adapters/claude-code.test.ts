import { describe, expect, it, vi } from "vitest";
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

/** A fake `ProcessIo` whose exit can be triggered on demand by the test,
 * standing in for the real child process claude-code.ts spawns. */
function createFakeProcessIo(): {
	io: ProcessIo;
	triggerExit(info: ProcessExitInfo): void;
} {
	const exitHandlers: Array<(info: ProcessExitInfo) => void> = [];
	return {
		io: {
			child: {} as ProcessIo["child"],
			lines: neverEndingLines,
			onExit: (handler) => exitHandlers.push(handler),
			stderrLines: neverEndingLines,
			stop: vi.fn(),
			writeLine: vi.fn(),
		},
		triggerExit(info: ProcessExitInfo): void {
			for (const handler of exitHandlers) {
				handler(info);
			}
		},
	};
}

describe("claudeCodeAdapter", () => {
	it("closes `events` once the underlying process exits on its own", async () => {
		const { io, triggerExit } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await claudeCodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		// Nothing has happened yet: the agent is still "running".
		const pending = Promise.race([
			iterator.next().then(() => "settled"),
			Promise.resolve().then(() => "still-pending"),
		]);
		expect(await pending).toBe("still-pending");

		// The process crashes (or simply exits) without anyone calling stop().
		triggerExit({ code: 1, signal: null });

		const result = await iterator.next();
		expect(result.done).toBe(true);
	});
});
