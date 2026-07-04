// Shared newline-delimited JSON-RPC-over-stdio plumbing for the opencode
// (ACP) and codex (app-server) adapters: both speak request/response +
// server-to-client notifications down the same pipe. `connectJsonRpc` itself
// is exercised in jsonrpc-io.test.ts against real short-lived processes (see
// process-io.ts for why that's safe in CI); the "codex"/"opencode" binaries
// it's actually invoked with in production are not.
//
// Known gap: neither adapter answers server-initiated requests (e.g. codex's
// `item/commandExecution/requestApproval`) — those arrive with a `method` and
// an `id` and are surfaced as ordinary notifications instead of being replied
// to, which will stall a turn that needs approval. Wiring approvals through
// to the web UI is out of scope for this task; tracked as a follow-up.

import { isRecord } from "../normalize/types";
import { type ProcessExitInfo, spawnProcessIo } from "./process-io";

export interface JsonRpcIo {
	notify(method: string, params: unknown): void;
	onExit(handler: (info: ProcessExitInfo) => void): void;
	onNotification(handler: (method: string, params: unknown) => void): void;
	request(method: string, params: unknown): Promise<unknown>;
	stop(): void;
}

interface PendingRequest {
	reject(reason: unknown): void;
	resolve(value: unknown): void;
}

/** Message used both to settle in-flight requests when the process exits and
 * to reject any `request()` call made afterwards — in both cases the agent
 * is gone before it could answer. */
const EXIT_ERROR_MESSAGE = "agent process exited before responding";

/** Rejects every still-outstanding `request()` call and clears the map, so a
 * dead child process can never leave a caller awaiting a response forever. */
function rejectAllPending(pending: Map<number, PendingRequest>): void {
	for (const waiter of pending.values()) {
		waiter.reject(new Error(EXIT_ERROR_MESSAGE));
	}
	pending.clear();
}

function tryParseJson(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

/** Settles a pending `request()` call from its matching response line, if any is still waiting. */
function settlePendingResponse(
	parsed: Record<string, unknown>,
	pending: Map<number, PendingRequest>
): void {
	const waiter = pending.get(parsed.id as number);
	pending.delete(parsed.id as number);
	if (!waiter) {
		return;
	}
	if ("error" in parsed) {
		waiter.reject(parsed.error);
	} else {
		waiter.resolve(parsed.result);
	}
}

/** Dispatches a single parsed line to either a pending request or the notification handlers. */
function handleLine(
	line: string,
	pending: Map<number, PendingRequest>,
	handlers: Array<(method: string, params: unknown) => void>
): void {
	const parsed = tryParseJson(line);
	if (!isRecord(parsed)) {
		return;
	}
	if (
		typeof parsed.id === "number" &&
		("result" in parsed || "error" in parsed)
	) {
		settlePendingResponse(parsed, pending);
		return;
	}
	if (typeof parsed.method === "string") {
		for (const handler of handlers) {
			handler(parsed.method, parsed.params);
		}
	}
}

export async function connectJsonRpc(
	command: string,
	args: string[],
	cwd: string
): Promise<JsonRpcIo> {
	const io = await spawnProcessIo(command, args, cwd);
	const pending = new Map<number, PendingRequest>();
	const handlers: Array<(method: string, params: unknown) => void> = [];
	let nextId = 1;
	let exited = false;

	(async () => {
		for await (const line of io.lines) {
			handleLine(line, pending, handlers);
		}
	})();

	// A dead child can never answer whatever's still outstanding: settle it
	// now instead of leaving `request()` callers awaiting forever, and reject
	// any request made after this point immediately.
	io.onExit(() => {
		exited = true;
		rejectAllPending(pending);
	});

	return {
		request(method: string, params: unknown): Promise<unknown> {
			if (exited) {
				return Promise.reject(new Error(EXIT_ERROR_MESSAGE));
			}
			const id = nextId++;
			return new Promise((resolve, reject) => {
				pending.set(id, { resolve, reject });
				io.writeLine(JSON.stringify({ id, method, params }));
			});
		},
		notify(method: string, params: unknown): void {
			io.writeLine(JSON.stringify({ method, params }));
		},
		onExit(handler: (info: ProcessExitInfo) => void): void {
			io.onExit(handler);
		},
		onNotification(handler: (method: string, params: unknown) => void): void {
			handlers.push(handler);
		},
		stop(): void {
			io.stop();
		},
	};
}
