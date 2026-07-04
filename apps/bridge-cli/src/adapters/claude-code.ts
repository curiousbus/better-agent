import {
	buildClaudeInputFrame,
	normalizeClaudeCode,
} from "../normalize/claude-code";
import type { NormalizedEvent } from "../normalize/types";
import { createAsyncQueue } from "./async-queue";
import { spawnProcessIo } from "./process-io";
import type { Adapter, AgentHandle } from "./types";

const CLAUDE_ARGS = [
	"-p",
	"--output-format",
	"stream-json",
	"--input-format",
	"stream-json",
	"--verbose",
];

function tryParseJson(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

/** `claude -p --output-format stream-json --input-format stream-json --verbose`. */
export const claudeCodeAdapter: Adapter = {
	async start(dir: string): Promise<AgentHandle> {
		const io = await spawnProcessIo("claude", CLAUDE_ARGS, dir);
		const events = createAsyncQueue<NormalizedEvent>();
		io.onExit(() => events.close());

		(async () => {
			for await (const line of io.lines) {
				const parsed = tryParseJson(line);
				for (const event of normalizeClaudeCode(parsed)) {
					events.push(event);
				}
			}
		})();

		(async () => {
			for await (const line of io.stderrLines) {
				events.push({ kind: "error", message: line });
			}
		})();

		return {
			events,
			send(text: string): void {
				io.writeLine(buildClaudeInputFrame(text));
			},
			stop(): void {
				io.stop();
			},
		};
	},
};
