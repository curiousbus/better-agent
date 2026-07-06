import {
	buildPiGetCommandsCommand,
	buildPiGetStateCommand,
	buildPiPromptCommand,
	normalizePi,
	normalizePiCommandsResponse,
	normalizePiStateModel,
} from "../normalize/pi";
import { type NormalizedEvent, userMessageEvent } from "../normalize/types";
import { createApprovalRegistry } from "./approvals";
import { createAsyncQueue } from "./async-queue";
import { spawnProcessIo } from "./process-io";
import { type Adapter, AGENT_EXITED_STATUS, type AgentHandle } from "./types";

/** ASSUMPTION (unverified, no `pi` binary available in this sandbox): `pi`'s
 * RPC mode is invoked as `pi --mode rpc`, with the working directory set via
 * the spawned process's cwd (there's no documented command to set it
 * per-session, unlike codex's `thread/start` or opencode's `session/new`).
 * See the ASSUMPTION note in normalize/pi.ts for the protocol shapes. */
const PI_ARGS = ["--mode", "rpc"];

function tryParseJson(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

/**
 * Tracks the two pieces `session_ready` is assembled from — `get_state`'s
 * model (which may arrive before or after `get_commands`' response, since
 * both are fired off at start with no ordering guarantee) and `get_commands`'
 * slash commands/skills — and pushes exactly one `session_ready` event, the
 * moment the commands list is known (using whatever model has arrived by
 * then, if any).
 */
function makePiSessionReadyTracker(events: {
	push(event: NormalizedEvent): void;
}): {
	onLine(raw: unknown): void;
} {
	let emitted = false;
	let model: string | undefined;
	return {
		onLine(raw: unknown): void {
			const nextModel = normalizePiStateModel(raw);
			if (nextModel !== undefined) {
				model = nextModel;
			}
			if (emitted) {
				return;
			}
			const commands = normalizePiCommandsResponse(raw);
			if (!commands) {
				return;
			}
			emitted = true;
			events.push({
				kind: "status",
				status: "session_ready",
				detail: { model, ...commands },
			});
		},
	};
}

/**
 * `pi --mode rpc` — Mario Zechner's `pi` coding agent's headless JSON-over-
 * stdio mode. Unlike codex/opencode/claude-code, pi has no per-tool-call
 * approval protocol at all (see normalize/pi.ts), so `answerApproval` is
 * wired to an approval registry that never has anything registered — any
 * call to it always emits the shared "unknown request" status event.
 */
export const piAdapter: Adapter = {
	async start(dir: string): Promise<AgentHandle> {
		const io = await spawnProcessIo("pi", PI_ARGS, dir);
		const events = createAsyncQueue<NormalizedEvent>();
		const approvals = createApprovalRegistry(events);
		io.onExit(() => {
			events.push({ kind: "status", status: AGENT_EXITED_STATUS });
			events.close();
			approvals.clear();
		});

		const sessionReady = makePiSessionReadyTracker(events);
		(async () => {
			for await (const line of io.lines) {
				const raw = tryParseJson(line);
				sessionReady.onLine(raw);
				for (const event of normalizePi(raw)) {
					events.push(event);
				}
			}
		})();

		(async () => {
			for await (const line of io.stderrLines) {
				events.push({ kind: "error", message: line });
			}
		})();

		// Fired off once, right at start — see the ASSUMPTION note on
		// `normalizePiCommandsResponse`/`normalizePiStateModel` in normalize/pi.ts
		// for the response shapes `sessionReady` parses out of whichever of
		// these two lines comes back first.
		io.writeLine(buildPiGetStateCommand());
		io.writeLine(buildPiGetCommandsCommand());

		return {
			answerApproval(requestId: string, optionId: string): void {
				approvals.answer(requestId, optionId);
			},
			events,
			send(text: string): void {
				events.push(userMessageEvent(text));
				io.writeLine(buildPiPromptCommand(text));
			},
			stop(): void {
				io.stop();
				events.close();
				approvals.clear();
			},
		};
	},
};
