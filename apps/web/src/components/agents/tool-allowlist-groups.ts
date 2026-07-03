import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { McpServerRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

export interface ToolRow {
	description: string;
	name: string;
}

export interface ToolGroup {
	key: string;
	label: string;
	tools: ToolRow[];
}

export type Mode = "all" | "selected";

export function modeOf(allowlist: string[] | null): Mode {
	return allowlist === null ? "all" : "selected";
}

export function allToolNames(groups: ToolGroup[]): string[] {
	return groups.flatMap((group) => group.tools.map((tool) => tool.name));
}

// Purpose group for a composio tool name: the prefix before the first
// underscore (GMAIL_SEND_EMAIL -> GMAIL).
function prefixOf(name: string): string {
	const cut = name.indexOf("_");
	return cut === -1 ? name : name.slice(0, cut);
}

function buildComposioGroups(
	results: { data?: { tools: ToolRow[] } }[]
): ToolGroup[] {
	const byPrefix = new Map<string, ToolRow[]>();
	for (const result of results) {
		for (const tool of result.data?.tools ?? []) {
			const prefix = prefixOf(tool.name);
			const list = byPrefix.get(prefix) ?? [];
			list.push(tool);
			byPrefix.set(prefix, list);
		}
	}
	return [...byPrefix.entries()]
		.map(([label, tools]) => ({
			key: `composio:${label}`,
			label,
			tools: [...tools].sort((a, b) => a.name.localeCompare(b.name)),
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

function buildMcpGroups(
	serverIds: string[],
	servers: McpServerRow[] | undefined,
	results: { data?: ToolRow[] }[]
): ToolGroup[] {
	return serverIds.map((serverId, index) => {
		const label =
			servers?.find((row) => row.id === serverId)?.name ?? "MCP server";
		const tools = [...(results[index].data ?? [])].sort((a, b) =>
			a.name.localeCompare(b.name)
		);
		return { key: `mcp:${serverId}`, label, tools };
	});
}

// Toggle handlers for the allowlist array: flip a single tool, or a whole
// group at once (used by the picker's "Select all" / "Clear" pair).
export function useToolToggles(
	selected: string[],
	set: (patch: { toolAllowlist: string[] }) => void
) {
	const toggleTool = (name: string, checked: boolean) => {
		const next = checked
			? [...selected, name]
			: selected.filter((value) => value !== name);
		set({ toolAllowlist: next });
	};

	const toggleGroup = (group: ToolGroup, checked: boolean) => {
		const names = group.tools.map((tool) => tool.name);
		const next = checked
			? [...new Set([...selected, ...names])]
			: selected.filter((value) => !names.includes(value));
		set({ toolAllowlist: next });
	};

	return { toggleTool, toggleGroup };
}

// Cheap group labels: reuse the account/server list queries the Composio and
// MCP fields above already populate, so this is a cache hit, not a new call.
export function useToolSources(accountIds: string[], serverIds: string[]) {
	const composioResults = useQueries({
		queries: accountIds.map((accountId) =>
			orpc.composio.tools.queryOptions({ input: { accountId } })
		),
	});
	const mcpServers = useQuery(orpc.mcp.listServers.queryOptions());
	const mcpResults = useQueries({
		queries: serverIds.map((serverId) =>
			orpc.mcp.tools.queryOptions({ input: { serverId } })
		),
	});
	const isPending =
		composioResults.some((r) => r.isPending) ||
		mcpResults.some((r) => r.isPending);
	const errors = [...composioResults, ...mcpResults]
		.map((r) => r.error)
		.filter((error): error is Error => error !== null);
	const groups = useMemo(() => {
		if (isPending) {
			return [];
		}
		return [
			...buildComposioGroups(composioResults),
			...buildMcpGroups(serverIds, mcpServers.data, mcpResults),
		];
	}, [isPending, composioResults, mcpResults, mcpServers.data, serverIds]);
	return { groups, isPending, errors };
}
