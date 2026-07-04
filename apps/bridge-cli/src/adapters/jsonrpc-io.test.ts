import { describe, expect, it } from "vitest";
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
});
