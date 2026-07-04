#!/usr/bin/env node
import { selectAdapter } from "./adapters/index";
import { parseArgs } from "./args";
import { runBridgeSession } from "./relay-client";
import { createRelayTransport } from "./relay-transport";

// `process.argv` is `[nodeExecutable, scriptPath, ...userArgs]`.
const CLI_ARGS_START_INDEX = 2;

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(CLI_ARGS_START_INDEX));
	const adapter = selectAdapter(args.agentKind);
	const transport = createRelayTransport({
		serverUrl: args.serverUrl,
		token: args.token,
	});
	const handle = await adapter.start(args.dir);
	const controller = new AbortController();

	const stop = () => {
		controller.abort();
		handle.stop();
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	const { sessionId } = await runBridgeSession({
		agentKind: args.agentKind,
		label: args.label,
		transport,
		handle,
		signal: controller.signal,
	});

	process.stdout.write(`Bridge session ended: ${sessionId}\n`);
}

main().catch((error: unknown) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`
	);
	process.exitCode = 1;
});
