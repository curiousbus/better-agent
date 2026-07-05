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
	process.stdout.write(
		`Starting ${args.agentKind} in ${args.dir} → ${args.serverUrl}\n`
	);
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
		onStart: (id) =>
			process.stdout.write(
				`Connected. Session ${id}. Drive it from the web Local Agent view; input here is forwarded to the agent.\n`
			),
		pollOptions: args.debug
			? {
					onCommands: (commands) =>
						process.stderr.write(`← command(s): ${JSON.stringify(commands)}\n`),
				}
			: undefined,
		forwardOptions: {
			onWarning: (message) => process.stderr.write(`${message}\n`),
			onEvent: args.debug
				? (event) => process.stderr.write(`→ event: ${JSON.stringify(event)}\n`)
				: undefined,
		},
	});

	process.stdout.write(`Bridge session ended: ${sessionId}\n`);
}

main().catch((error: unknown) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`
	);
	process.exitCode = 1;
});
