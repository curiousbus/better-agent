// Shared newline-delimited JSON-RPC-over-stdio plumbing for the opencode
// (ACP) and codex (app-server) adapters: both speak request/response +
// server-to-client notifications *and requests* down the same pipe.
// `connectJsonRpc` itself is exercised in jsonrpc-io.test.ts against real
// short-lived processes (see process-io.ts for why that's safe in CI); the
// "codex"/"opencode" binaries it's actually invoked with in production are
// not.
//
// Three shapes of inbound line, distinguished by which of `id`/`method` are
// present: a *response* to one of our own `request()` calls (`id` +
// `result`/`error`), a *notification* (`method`, no `id`), or a
// *server-initiated request* (both `id` and `method`) — e.g. codex's
// approval requests or opencode's `session/request_permission`. `onRequest`
// surfaces the latter; `respond` answers it.

import { isRecord } from "../normalize/types";
import {
	type ProcessExitInfo,
	type ProcessIo,
	spawnProcessIo,
} from "./process-io";

export interface JsonRpcIo {
	notify(method: string, params: unknown): void;
	onExit(handler: (info: ProcessExitInfo) => void): void;
	onNotification(handler: (method: string, params: unknown) => void): void;
	/** Registers a handler for server-initiated requests (inbound lines with
	 * both an `id` and a `method`). The id may be a string or a number — unlike
	 * ids we mint ourselves in `request()` (always numeric, from our own
	 * counter), JSON-RPC servers are free to use either. Reply with
	 * `respond(id, result)`, echoing back whichever type was received. */
	onRequest(
		handler: (id: number | string, method: string, params: unknown) => void
	): void;
	request(method: string, params: unknown): Promise<unknown>;
	/** Answers a server-initiated request surfaced via `onRequest`, echoing
	 * back its `id` verbatim (string or number). */
	respond(id: number | string, result: unknown): void;
	stop(): void;
}

interface PendingRequest {
	reject(reason: unknown): void;
	resolve(value: unknown): void;
}

type NotificationHandler = (method: string, params: unknown) => void;
type RequestHandler = (
	id: number | string,
	method: string,
	params: unknown
) => void;

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

/** A server-initiated request's `id` may be either shape on the wire; ids we
 * mint ourselves (in `request()`) are always numeric, but we must accept
 * either here since we don't control the server's choice. */
function isRequestId(value: unknown): value is number | string {
	return typeof value === "number" || typeof value === "string";
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

/** Dispatches a single parsed line to a pending request, a notification
 * handler, or — for an inbound message carrying both an `id` and a
 * `method` — a request handler. */
function handleLine(
	line: string,
	pending: Map<number, PendingRequest>,
	notificationHandlers: NotificationHandler[],
	requestHandlers: RequestHandler[]
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
	if (typeof parsed.method !== "string") {
		return;
	}
	if (isRequestId(parsed.id)) {
		for (const handler of requestHandlers) {
			handler(parsed.id, parsed.method, parsed.params);
		}
		return;
	}
	for (const handler of notificationHandlers) {
		handler(parsed.method, parsed.params);
	}
}

interface JsonRpcState {
	exited: boolean;
	nextId: number;
	notificationHandlers: NotificationHandler[];
	pending: Map<number, PendingRequest>;
	requestHandlers: RequestHandler[];
}

function createJsonRpcState(): JsonRpcState {
	return {
		exited: false,
		nextId: 1,
		notificationHandlers: [],
		pending: new Map(),
		requestHandlers: [],
	};
}

/** Builds the public `JsonRpcIo` surface over an already-spawned process and
 * its shared mutable state. Split out of `connectJsonRpc` purely to keep
 * that function short. */
function buildJsonRpcIo(io: ProcessIo, state: JsonRpcState): JsonRpcIo {
	return {
		request(method: string, params: unknown): Promise<unknown> {
			if (state.exited) {
				return Promise.reject(new Error(EXIT_ERROR_MESSAGE));
			}
			const id = state.nextId++;
			return new Promise((resolve, reject) => {
				state.pending.set(id, { resolve, reject });
				io.writeLine(JSON.stringify({ id, method, params }));
			});
		},
		notify(method: string, params: unknown): void {
			io.writeLine(JSON.stringify({ method, params }));
		},
		respond(id: number | string, result: unknown): void {
			// Mirrors the `state.exited` guard in `request()`: a dead child can
			// never read this reply, so silently drop it instead of writing to a
			// closed pipe.
			if (state.exited) {
				return;
			}
			io.writeLine(JSON.stringify({ id, result }));
		},
		onExit(handler: (info: ProcessExitInfo) => void): void {
			io.onExit(handler);
		},
		onNotification(handler: NotificationHandler): void {
			state.notificationHandlers.push(handler);
		},
		onRequest(handler: RequestHandler): void {
			state.requestHandlers.push(handler);
		},
		stop(): void {
			io.stop();
		},
	};
}

export async function connectJsonRpc(
	command: string,
	args: string[],
	cwd: string
): Promise<JsonRpcIo> {
	const io = await spawnProcessIo(command, args, cwd);
	const state = createJsonRpcState();

	(async () => {
		for await (const line of io.lines) {
			handleLine(
				line,
				state.pending,
				state.notificationHandlers,
				state.requestHandlers
			);
		}
	})();

	// A dead child can never answer whatever's still outstanding: settle it
	// now instead of leaving `request()` callers awaiting forever, and reject
	// any request made after this point immediately.
	io.onExit(() => {
		state.exited = true;
		rejectAllPending(state.pending);
	});

	return buildJsonRpcIo(io, state);
}
