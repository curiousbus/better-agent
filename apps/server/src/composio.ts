import type {
	ComposioConnectionMeta,
	ComposioService,
	ComposioToolkitMeta,
	ComposioToolMeta,
} from "@better-agent/agent/tool/composio-tools";
import type { ExecuteResult } from "@better-agent/agent/tool/types";
import { Composio } from "@composio/core";

/** The subset of an OpenAI-format composio tool we read. */
interface OpenAiTool {
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
	type: "function";
}

/**
 * The subset of a composio execute result we read.
 * `data` is Record<string, unknown> and `error` is string | null
 * per ToolExecuteResponseSchema in @composio/core@0.11.x.
 */
interface ComposioResult {
	data: Record<string, unknown>;
	error: string | null;
	successful: boolean;
}

/** The subset of a connected account item from @composio/core@0.11 that we read. */
interface ConnectedAccountItem {
	id: string;
	status: string;
	toolkit: { slug: string };
}

/** The subset of a ToolKitItem from @composio/core@0.11 that we read. */
interface ToolKitItem {
	authSchemes?: string[];
	meta?: { description?: string };
	name: string;
	noAuth?: boolean;
	slug: string;
}

export function mapConnection(
	item: ConnectedAccountItem
): ComposioConnectionMeta {
	return {
		id: item.id,
		toolkitSlug: item.toolkit.slug,
		status: item.status,
		active: item.status === "ACTIVE",
	};
}

export function mapToolkit(item: ToolKitItem): ComposioToolkitMeta {
	const needsAuth =
		!item.noAuth && (item.authSchemes ?? []).some((s) => s !== "NO_AUTH");
	return {
		slug: item.slug,
		name: item.name,
		description: item.meta?.description ?? "",
		needsAuth,
	};
}

export function mapOpenAiTool(tool: OpenAiTool): ComposioToolMeta {
	return {
		name: tool.function.name,
		description: tool.function.description ?? "",
		parameters: tool.function.parameters ?? {},
	};
}

export function mapComposioResult(result: ComposioResult): ExecuteResult {
	if (result.successful) {
		return { output: JSON.stringify(result.data) };
	}
	return { output: result.error ?? "Tool execution failed", isError: true };
}

export function createComposioService(config: {
	apiKey: string;
	toolkits: string[];
}): ComposioService {
	const composio = new Composio({ apiKey: config.apiKey });
	return {
		async listTools(userId, toolkits) {
			const resolved = toolkits.length > 0 ? toolkits : config.toolkits;
			if (resolved.length === 0) {
				return [];
			}
			const tools = await composio.tools.get(userId, { toolkits: resolved });
			return (tools as OpenAiTool[]).map(mapOpenAiTool);
		},
		async execute({ userId, toolName, args }) {
			const result = (await composio.tools.execute(toolName, {
				userId,
				arguments: (args ?? {}) as Record<string, unknown>,
				// We don't pin tool versions; skip the SDK's version-match check
				// so execute always runs against composio's current tool version.
				dangerouslySkipVersionCheck: true,
			})) as ComposioResult;
			return mapComposioResult(result);
		},
		async listToolkits() {
			const toolkits = await composio.toolkits.get({
				sortBy: "alphabetically",
				limit: 100,
			});
			return (toolkits as ToolKitItem[]).map(mapToolkit);
		},
		async connect(userId, toolkit) {
			const req = await composio.toolkits.authorize(userId, toolkit);
			return { redirectUrl: req.redirectUrl ?? "" };
		},
		async listConnections(userId) {
			const res = (await composio.connectedAccounts.list({
				userIds: [userId],
			})) as { items: ConnectedAccountItem[] };
			return res.items.map(mapConnection);
		},
		async disconnect(connectionId) {
			await composio.connectedAccounts.delete(connectionId);
		},
	};
}
