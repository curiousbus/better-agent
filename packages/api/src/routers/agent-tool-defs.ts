import { buildBuiltinToolDefs } from "@better-agent/agent/tool/builtin-tools";
import {
	buildComposioToolDefs,
	type ComposioService,
} from "@better-agent/agent/tool/composio-tools";
import {
	buildMcpToolDefs,
	type McpService,
} from "@better-agent/agent/tool/mcp-tools";
import type { ToolDef } from "@better-agent/agent/tool/types";
import type { Context } from "../context";

// `scope` is the composio "user" scope — here a composio account id. Builds the
// tool defs for every authenticated toolkit of that account.
export async function safeComposioDefs(
	service: ComposioService | null,
	scope: string
): Promise<ToolDef[]> {
	if (!service) {
		return [];
	}
	try {
		const connections = await service.listConnections(scope);
		const toolkits = [
			...new Set(connections.filter((c) => c.active).map((c) => c.toolkitSlug)),
		];
		if (toolkits.length === 0) {
			return [];
		}
		return await buildComposioToolDefs(service, scope, toolkits);
	} catch {
		return [];
	}
}

// Tools from one linked MCP server; failures are logged server-side and yield
// no tools, so a broken server never breaks the whole turn.
export async function safeMcpDefs(
	service: McpService | null
): Promise<ToolDef[]> {
	if (!service) {
		return [];
	}
	try {
		return await buildMcpToolDefs(service);
	} catch {
		return [];
	}
}

// Composio/MCP tools are bulky and numerous: mark them deferrable (hidden
// behind search_tools past the runtime's threshold) and honor the agent's
// optional tool allowlist.
function shapeSourceDefs(
	defs: ToolDef[],
	allowlist: string[] | null
): ToolDef[] {
	const allowed = allowlist
		? defs.filter((def) => allowlist.includes(def.name))
		: defs;
	return allowed.map((def) => ({ ...def, defer: true }));
}

// An agent's tools: every authenticated toolkit of each linked composio account,
// each linked MCP server's tools, plus its enabled built-in tools.
export async function assembleAgentToolDefs(
	context: Context,
	agent: {
		builtinTools: string[];
		composioAccountIds: string[];
		mcpServerIds: string[];
		toolAllowlist?: string[] | null;
	}
): Promise<ToolDef[]> {
	const perAccount = await Promise.all(
		(agent.composioAccountIds ?? []).map(async (accountId) => {
			const service = await context.services.composio(accountId);
			return safeComposioDefs(service, accountId);
		})
	);
	const perServer = await Promise.all(
		(agent.mcpServerIds ?? []).map(async (serverId) =>
			safeMcpDefs(await context.services.mcp(serverId))
		)
	);
	const allowlist = agent.toolAllowlist ?? null;
	return [
		...shapeSourceDefs([...perAccount.flat(), ...perServer.flat()], allowlist),
		...buildBuiltinToolDefs(agent.builtinTools ?? []),
	];
}
