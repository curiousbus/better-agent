import {
	buildClaudeControlResponse,
	buildClaudeInputFrame,
	normalizeClaudeCode,
	normalizeClaudeControlRequest,
} from "../normalize/claude-code";
import type { NormalizedEvent } from "../normalize/types";
import { createApprovalRegistry } from "./approvals";
import { createAsyncQueue } from "./async-queue";
import { spawnProcessIo } from "./process-io";
import { type Adapter, AGENT_EXITED_STATUS, type AgentHandle } from "./types";

const CLAUDE_ARGS = [
	"-p",
	"--output-format",
	"stream-json",
	"--input-format",
	"stream-json",
	"--verbose",
	// Routes tool-permission prompts through control_request/control_response
	// stdio frames instead of auto-denying them in non-interactive mode. See
	// the ASSUMPTION note in normalize/claude-code.ts about the frame shapes.
	"--permission-prompt-tool",
	"stdio",
];

function tryParseJson(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

/**
 * Handles one already-parsed stdout line: if it's a `can_use_tool` control
 * request, registers its reply function and pushes the approval event, and
 * returns `true` so the caller skips re-processing it as an ordinary
 * stream-json line. Returns `false` for everything else.
 */
function handleClaudeLine(
	parsed: unknown,
	io: { writeLine(line: string): void },
	approvals: ReturnType<typeof createApprovalRegistry>,
	events: { push(event: NormalizedEvent): void }
): boolean {
	const [event] = normalizeClaudeControlRequest(parsed);
	if (!event) {
		return false;
	}
	approvals.register(event.requestId, event.options, (optionId) => {
		io.writeLine(buildClaudeControlResponse(event.requestId, optionId));
	});
	events.push(event);
	return true;
}

/** `claude -p --output-format stream-json --input-format stream-json
 * --verbose --permission-prompt-tool stdio`. */
export const claudeCodeAdapter: Adapter = {
	async start(dir: string): Promise<AgentHandle> {
		const io = await spawnProcessIo("claude", CLAUDE_ARGS, dir);
		const events = createAsyncQueue<NormalizedEvent>();
		const approvals = createApprovalRegistry(events);
		io.onExit(() => {
			events.push({ kind: "status", status: AGENT_EXITED_STATUS });
			events.close();
			approvals.clear();
		});

		(async () => {
			for await (const line of io.lines) {
				const parsed = tryParseJson(line);
				if (handleClaudeLine(parsed, io, approvals, events)) {
					continue;
				}
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
			answerApproval(requestId: string, optionId: string): void {
				approvals.answer(requestId, optionId);
			},
			events,
			send(text: string): void {
				io.writeLine(buildClaudeInputFrame(text));
			},
			stop(): void {
				io.stop();
				approvals.clear();
			},
		};
	},
};
