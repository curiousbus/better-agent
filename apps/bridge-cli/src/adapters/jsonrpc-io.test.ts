import { describe, expect, it, vi } from "vitest";
import { connectJsonRpc } from "./jsonrpc-io";

// See process-io.test.ts: spawning this is exactly the ENOENT path, and is
// safe in CI because it never starts a real agent.
const NONEXISTENT_BINARY = "definitely-not-a-real-binary-xyz123";

// A tiny stdio JSON-RPC "server": answers exactly one request, then exits on
// its own — standing in for a real `codex`/`opencode` process crashing or
// finishing unprompted, without depending on either binary being installed.
const ECHO_ONCE_SCRIPT = [
	'const readline = require("node:readline");',
	"const rl = readline.createInterface({ input: process.stdin });",
	'rl.once("line", (line) => {',
	"  const msg = JSON.parse(line);",
	'  process.stdout.write(JSON.stringify({ id: msg.id, result: { echoed: msg.params } }) + "\\n");',
	"  process.exit(0);",
	"});",
].join("\n");

// A tiny stdio JSON-RPC "server" that immediately sends a server-initiated
// *request* (both `id` and `method`), then echoes back whatever `result` it's
// answered with via `respond()`, then exits — standing in for a real codex/
// opencode approval request.
const REQUEST_THEN_ECHO_SCRIPT = [
	'const readline = require("node:readline");',
	"const rl = readline.createInterface({ input: process.stdin });",
	'process.stdout.write(JSON.stringify({ id: 1, method: "need_approval", params: { foo: "bar" } }) + "\\n");',
	'rl.once("line", (line) => {',
	"  const msg = JSON.parse(line);",
	'  process.stdout.write(JSON.stringify({ type: "received", result: msg.result }) + "\\n");',
	"  process.exit(0);",
	"});",
].join("\n");

describe("connectJsonRpc", () => {
	it("rejects with a clean message when the binary isn't installed", async () => {
		await expect(
			connectJsonRpc(NONEXISTENT_BINARY, [], process.cwd())
		).rejects.toThrow(
			`failed to start "${NONEXISTENT_BINARY}": ENOENT (is it installed and on PATH?)`
		);
	});

	it("still answers a request, then reports onExit once the process exits unprompted", async () => {
		const rpc = await connectJsonRpc(
			process.execPath,
			["-e", ECHO_ONCE_SCRIPT],
			process.cwd()
		);
		const exited = new Promise((resolve) => rpc.onExit(resolve));

		const result = await rpc.request("ping", { hello: "world" });

		expect(result).toEqual({ echoed: { hello: "world" } });
		await exited;
	});

	it("rejects an in-flight request (and any made afterwards) once the process exits", async () => {
		// Never answers, so `hang` below would wait forever without the exit
		// handling under test — standing in for the agent dying mid-request.
		const HANGING_SCRIPT = "process.stdin.resume();";
		const rpc = await connectJsonRpc(
			process.execPath,
			["-e", HANGING_SCRIPT],
			process.cwd()
		);

		const hang = rpc.request("initialize", {});
		rpc.stop();

		await expect(hang).rejects.toThrow(
			"agent process exited before responding"
		);
		await expect(rpc.request("ping", {})).rejects.toThrow(
			"agent process exited before responding"
		);
	});
});

describe("connectJsonRpc - server-initiated requests", () => {
	it("surfaces a server-initiated request via onRequest, distinct from a notification", async () => {
		const rpc = await connectJsonRpc(
			process.execPath,
			["-e", REQUEST_THEN_ECHO_SCRIPT],
			process.cwd()
		);
		const notified = vi.fn();
		rpc.onNotification(notified);
		const received = new Promise<{
			id: number;
			method: string;
			params: unknown;
		}>((resolve) => {
			rpc.onRequest((id, method, params) => resolve({ id, method, params }));
		});

		const request = await received;
		expect(request).toEqual({
			id: 1,
			method: "need_approval",
			params: { foo: "bar" },
		});
		expect(notified).not.toHaveBeenCalled();

		rpc.respond(request.id, { decision: "accept" });
		await new Promise((resolve) => rpc.onExit(resolve));
	});
});
