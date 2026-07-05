import {
	buildClaudeControlResponse,
	extractClaudeSessionId,
	normalizeClaudeCode,
	normalizeClaudeControlRequest,
} from "../normalize/claude-code";
import type { NormalizedEvent } from "../normalize/types";
import { createApprovalRegistry } from "./approvals";
import { createAsyncQueue } from "./async-queue";
import { type ProcessIo, spawnProcessIo } from "./process-io";
import type { Adapter, AgentHandle } from "./types";

// One-shot per turn: `claude -p <prompt>` processes the prompt and exits. The
// persistent `--input-format stream-json` stdin mode silently DROPPED frames
// written to an already-open stdin (claude only reliably processes a complete
// input unit, i.e. a piped frame + EOF), so a bridge session runs claude fresh
// for each user turn and carries context via `--resume <session_id>`, captured
// from the previous turn's init line. Approval prompts still flow over that
// turn's stdio (`--permission-prompt-tool stdio`).
function turnArgs(prompt: string, sessionId: string | null): string[] {
	const base = [
		"-p",
		prompt,
		"--output-format",
		"stream-json",
		"--verbose",
		"--permission-prompt-tool",
		"stdio",
	];
	return sessionId ? [...base, "--resume", sessionId] : base;
}

function tryParseJson(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

type Approvals = ReturnType<typeof createApprovalRegistry>;

interface TurnContext {
	approvals: Approvals;
	current: ProcessIo | null;
	dir: string;
	events: { push(event: NormalizedEvent): void };
	pending: string[];
	running: boolean;
	sessionId: string | null;
	stopped: boolean;
}

/** A `can_use_tool` control request → an approval event, with its reply routed
 * back over THIS turn's stdin. Returns true when the line was an approval. */
function handleControlRequest(
	parsed: unknown,
	io: ProcessIo,
	approvals: Approvals,
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

async function runTurn(ctx: TurnContext, prompt: string): Promise<void> {
	const io = await spawnProcessIo(
		"claude",
		turnArgs(prompt, ctx.sessionId),
		ctx.dir
	);
	ctx.current = io;
	(async () => {
		for await (const line of io.stderrLines) {
			ctx.events.push({ kind: "error", message: line });
		}
	})();
	// The for-await over stdout ends when claude exits (or stop() kills it).
	for await (const line of io.lines) {
		const parsed = tryParseJson(line);
		ctx.sessionId = extractClaudeSessionId(parsed) ?? ctx.sessionId;
		if (handleControlRequest(parsed, io, ctx.approvals, ctx.events)) {
			continue;
		}
		for (const event of normalizeClaudeCode(parsed)) {
			ctx.events.push(event);
		}
	}
	ctx.current = null;
}

// Runs queued turns strictly one at a time (a new command that arrives mid-turn
// waits its turn), so `--resume` always chains onto the previous turn.
async function drainTurns(ctx: TurnContext): Promise<void> {
	if (ctx.running) {
		return;
	}
	ctx.running = true;
	while (ctx.pending.length > 0 && !ctx.stopped) {
		const next = ctx.pending.shift();
		if (next !== undefined) {
			await runTurn(ctx, next);
		}
	}
	ctx.running = false;
}

export const claudeCodeAdapter: Adapter = {
	// biome-ignore lint/suspicious/useAwait: interface returns a Promise; claude spawns lazily per turn, not at start.
	async start(dir: string): Promise<AgentHandle> {
		const events = createAsyncQueue<NormalizedEvent>();
		const ctx: TurnContext = {
			approvals: createApprovalRegistry(events),
			dir,
			events,
			pending: [],
			sessionId: null,
			current: null,
			running: false,
			stopped: false,
		};
		return {
			events,
			answerApproval(requestId: string, optionId: string): void {
				ctx.approvals.answer(requestId, optionId);
			},
			send(text: string): void {
				ctx.pending.push(text);
				drainTurns(ctx).catch((error: unknown) => {
					ctx.events.push({
						kind: "error",
						message: error instanceof Error ? error.message : String(error),
					});
				});
			},
			stop(): void {
				ctx.stopped = true;
				ctx.current?.stop();
				ctx.approvals.clear();
				events.close();
			},
		};
	},
};
