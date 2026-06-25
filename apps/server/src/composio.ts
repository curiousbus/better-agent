import type {
	ComposioService,
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
		async listTools(userId) {
			const tools = await composio.tools.get(userId, {
				toolkits: config.toolkits,
			});
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
	};
}
