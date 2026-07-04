import { describe, expect, it } from "vitest";
import { type ProcessExitInfo, spawnProcessIo } from "./process-io";

// A binary name no test environment will ever actually have installed.
// Spawning it is exactly the ENOENT path we need to cover — it never starts
// a real agent, so this is safe to run in CI.
const NONEXISTENT_BINARY = "definitely-not-a-real-binary-xyz123";

function waitForExit(
	io: Awaited<ReturnType<typeof spawnProcessIo>>
): Promise<ProcessExitInfo> {
	return new Promise((resolve) => io.onExit(resolve));
}

async function collectLines(lines: AsyncIterable<string>): Promise<string[]> {
	const collected: string[] = [];
	for await (const line of lines) {
		collected.push(line);
	}
	return collected;
}

describe("spawnProcessIo", () => {
	it("rejects with a clean, actionable message when the binary isn't installed", async () => {
		await expect(
			spawnProcessIo(NONEXISTENT_BINARY, [], process.cwd())
		).rejects.toThrow(
			`failed to start "${NONEXISTENT_BINARY}": ENOENT (is it installed and on PATH?)`
		);
	});

	it("never crashes the process with an unhandled 'error' event on ENOENT", async () => {
		// Regression guard for the original bug: before the fix, this rejection
		// was the *only* thing standing between a bad --dir/binary and Node's
		// EventEmitter throwing an uncaught exception. Reaching this line at
		// all (rather than the test process crashing) is the assertion.
		await expect(
			spawnProcessIo(NONEXISTENT_BINARY, [], process.cwd())
		).rejects.toBeInstanceOf(Error);
	});

	it("resolves once a real process spawns, and onExit reports its exit code", async () => {
		const EXIT_CODE = 7;
		const io = await spawnProcessIo(
			process.execPath,
			["-e", `process.exit(${EXIT_CODE})`],
			process.cwd()
		);

		const info = await waitForExit(io);

		expect(info.code).toBe(EXIT_CODE);
		expect(info.error).toBeUndefined();
	});

	it("closes `lines` once the process exits, after delivering its output", async () => {
		const io = await spawnProcessIo(
			process.execPath,
			["-e", "console.log('hello'); console.log('world');"],
			process.cwd()
		);

		const lines = await collectLines(io.lines);

		expect(lines).toEqual(["hello", "world"]);
	});
});
