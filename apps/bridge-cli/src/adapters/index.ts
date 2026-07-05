import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";
import { opencodeAdapter } from "./opencode";
import { piAdapter } from "./pi";
import type { Adapter, AgentKind } from "./types";

export type { Adapter, AgentHandle, AgentKind, StartOptions } from "./types";

/** Picks the adapter for the agent kind selected on the CLI (`--agent`). */
export function selectAdapter(agentKind: AgentKind): Adapter {
	switch (agentKind) {
		case "claude-code":
			return claudeCodeAdapter;
		case "opencode":
			return opencodeAdapter;
		case "codex":
			return codexAdapter;
		case "pi":
			return piAdapter;
		default:
			throw new Error(`Unknown agent kind: ${agentKind satisfies never}`);
	}
}
