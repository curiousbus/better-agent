// Shared child-process plumbing for the three stdio-based adapters: spawn a
// command, expose its stdout as a line-by-line async iterable, and provide a
// `writeLine` helper for newline-delimited stdin protocols. Not unit tested —
// the brief explicitly excludes spawning real agents from CI; this is
// exercised in practice by running the CLI against a real agent binary.

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createAsyncQueue } from "./async-queue";

export interface ProcessIo {
	child: ChildProcessWithoutNullStreams;
	/** stdout, split into lines. Completes when the process exits. */
	lines: AsyncIterable<string>;
	/** stderr, split into lines (surfaced by adapters as `error` events). */
	stderrLines: AsyncIterable<string>;
	stop(): void;
	writeLine(line: string): void;
}

export function spawnProcessIo(
	command: string,
	args: string[],
	cwd: string
): ProcessIo {
	const child = spawn(command, args, { cwd, stdio: "pipe" });

	const stdoutQueue = createAsyncQueue<string>();
	const stdoutReader = createInterface({ input: child.stdout });
	stdoutReader.on("line", (line) => stdoutQueue.push(line));
	child.stdout.on("close", () => stdoutQueue.close());

	const stderrQueue = createAsyncQueue<string>();
	const stderrReader = createInterface({ input: child.stderr });
	stderrReader.on("line", (line) => stderrQueue.push(line));
	child.stderr.on("close", () => stderrQueue.close());

	child.on("exit", () => {
		stdoutQueue.close();
		stderrQueue.close();
	});

	return {
		child,
		lines: stdoutQueue,
		stderrLines: stderrQueue,
		writeLine(line: string): void {
			child.stdin.write(`${line}\n`);
		},
		stop(): void {
			child.kill();
		},
	};
}
