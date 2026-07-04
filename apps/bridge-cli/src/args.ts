import type { AgentKind } from "./adapters/types";

const AGENT_KINDS: AgentKind[] = ["claude-code", "opencode", "codex"];

export interface BridgeCliArgs {
	agentKind: AgentKind;
	dir: string;
	label: string | undefined;
	serverUrl: string;
	token: string;
}

const FLAG_TO_FIELD = {
	"--agent": "agentKind",
	"--dir": "dir",
	"--label": "label",
	"--server": "serverUrl",
	"--token": "token",
} as const;

type FlagField = (typeof FLAG_TO_FIELD)[keyof typeof FLAG_TO_FIELD];

function isKnownFlag(flag: string): flag is keyof typeof FLAG_TO_FIELD {
	return flag in FLAG_TO_FIELD;
}

function collectFlags(argv: string[]): Partial<Record<FlagField, string>> {
	const values: Partial<Record<FlagField, string>> = {};
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag === undefined || !isKnownFlag(flag)) {
			continue;
		}
		const value = argv[index + 1];
		if (value === undefined) {
			throw new Error(`Missing value for ${flag}`);
		}
		values[FLAG_TO_FIELD[flag]] = value;
		index += 1;
	}
	return values;
}

function isAgentKind(value: string): value is AgentKind {
	return (AGENT_KINDS as string[]).includes(value);
}

/**
 * Parses `better-agent-bridge`'s CLI arguments: `--agent`, `--dir`,
 * `--token`, `--server`, and the optional `--label`. Falls back to env vars
 * (`BETTER_AGENT_BRIDGE_TOKEN`, `BETTER_AGENT_BRIDGE_SERVER`) and the current
 * working directory so the token/server don't have to be typed on every run.
 */
export function parseArgs(
	argv: string[],
	env: Record<string, string | undefined> = process.env
): BridgeCliArgs {
	const flags = collectFlags(argv);

	const agentKind = flags.agentKind;
	if (agentKind === undefined) {
		throw new Error("--agent is required (claude-code | opencode | codex)");
	}
	if (!isAgentKind(agentKind)) {
		throw new Error(
			`Unknown --agent "${agentKind}" (expected claude-code | opencode | codex)`
		);
	}

	const token = flags.token ?? env.BETTER_AGENT_BRIDGE_TOKEN;
	if (token === undefined) {
		throw new Error("--token is required (or set BETTER_AGENT_BRIDGE_TOKEN)");
	}

	const serverUrl = flags.serverUrl ?? env.BETTER_AGENT_BRIDGE_SERVER;
	if (serverUrl === undefined) {
		throw new Error("--server is required (or set BETTER_AGENT_BRIDGE_SERVER)");
	}

	return {
		agentKind,
		token,
		serverUrl,
		dir: flags.dir ?? process.cwd(),
		label: flags.label,
	};
}
