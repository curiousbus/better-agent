import { Button } from "@better-agent/ui/components/button";
import { Checkbox } from "@better-agent/ui/components/checkbox";
import { Label } from "@better-agent/ui/components/label";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQueries, useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

import type { AgentForm } from "./agent-form";

interface ToolRow {
	description: string;
	name: string;
}

interface SourceGroup {
	error: Error | null;
	isPending: boolean;
	key: string;
	label: string;
	tools: ToolRow[];
}

const SKELETON_ROWS = ["r1", "r2", "r3"] as const;
type Mode = "all" | "selected";

function modeOf(allowlist: string[] | null): Mode {
	return allowlist === null ? "all" : "selected";
}

function allToolNames(groups: SourceGroup[]): string[] {
	return groups.flatMap((group) => group.tools.map((tool) => tool.name));
}

// Cheap group labels: reuse the account/server list queries the Composio and
// MCP fields above already populate, so this is a cache hit, not a new call.
function useComposioGroups(accountIds: string[]): SourceGroup[] {
	const accounts = useQuery(orpc.composio.listAccounts.queryOptions());
	const results = useQueries({
		queries: accountIds.map((accountId) =>
			orpc.composio.tools.queryOptions({ input: { accountId } })
		),
	});
	return accountIds.map((accountId, index) => {
		const result = results[index];
		const name = accounts.data?.find((row) => row.id === accountId)?.name;
		return {
			key: `composio:${accountId}`,
			label: name ?? "Composio",
			tools: result.data?.tools ?? [],
			isPending: result.isPending,
			error: result.error,
		};
	});
}

function useMcpGroups(serverIds: string[]): SourceGroup[] {
	const servers = useQuery(orpc.mcp.listServers.queryOptions());
	const results = useQueries({
		queries: serverIds.map((serverId) =>
			orpc.mcp.tools.queryOptions({ input: { serverId } })
		),
	});
	return serverIds.map((serverId, index) => {
		const result = results[index];
		const name = servers.data?.find((row) => row.id === serverId)?.name;
		return {
			key: `mcp:${serverId}`,
			label: name ?? "MCP server",
			tools: result.data ?? [],
			isPending: result.isPending,
			error: result.error,
		};
	});
}

function ModeToggle({
	mode,
	onSelectAll,
	onSelectSome,
}: {
	mode: Mode;
	onSelectAll: () => void;
	onSelectSome: () => void;
}) {
	return (
		<div className="flex gap-1.5">
			<Button
				onClick={onSelectAll}
				size="sm"
				type="button"
				variant={mode === "all" ? "default" : "outline"}
			>
				All tools
			</Button>
			<Button
				onClick={onSelectSome}
				size="sm"
				type="button"
				variant={mode === "selected" ? "default" : "outline"}
			>
				Selected tools
			</Button>
		</div>
	);
}

function ToolCheckboxRow({
	tool,
	checked,
	onToggle,
}: {
	tool: ToolRow;
	checked: boolean;
	onToggle: (checked: boolean) => void;
}) {
	return (
		<Label className="flex items-start gap-2 font-normal">
			<Checkbox
				checked={checked}
				onCheckedChange={(next) => onToggle(next === true)}
			/>
			<span className="flex flex-col overflow-hidden">
				<span className="font-mono text-xs">{tool.name}</span>
				<span className="truncate text-muted-foreground text-xs">
					{tool.description}
				</span>
			</span>
		</Label>
	);
}

function SourceGroupSkeleton() {
	return (
		<div className="flex flex-col gap-1.5">
			{SKELETON_ROWS.map((row) => (
				<Skeleton className="h-4 w-3/4" key={row} />
			))}
		</div>
	);
}

function SourceGroupSection({
	group,
	selected,
	onToggle,
}: {
	group: SourceGroup;
	selected: string[];
	onToggle: (name: string, checked: boolean) => void;
}) {
	const showEmpty =
		!(group.isPending || group.error) && group.tools.length === 0;
	return (
		<div className="flex flex-col gap-1.5">
			<p className="font-medium text-xs">{group.label}</p>
			{group.isPending ? <SourceGroupSkeleton /> : null}
			{group.error ? (
				<p className="text-destructive text-xs">{group.error.message}</p>
			) : null}
			{showEmpty ? (
				<p className="text-muted-foreground text-xs">No tools reported.</p>
			) : null}
			<div className="flex flex-col gap-1.5">
				{group.tools.map((tool) => (
					<ToolCheckboxRow
						checked={selected.includes(tool.name)}
						key={tool.name}
						onToggle={(checked) => onToggle(tool.name, checked)}
						tool={tool}
					/>
				))}
			</div>
		</div>
	);
}

/**
 * Restricts the tools a linked Composio/MCP source offers this agent. Built-in
 * tools are unaffected — `toolAllowlist: null` (the default) means "all tools
 * of the linked sources"; an array means "only these tool names".
 */
export function ToolAllowlistField({
	form,
	set,
}: {
	form: AgentForm;
	set: (patch: Partial<AgentForm>) => void;
}) {
	const composioGroups = useComposioGroups(form.composioAccountIds);
	const mcpGroups = useMcpGroups(form.mcpServerIds);
	const groups = [...composioGroups, ...mcpGroups];
	const mode = modeOf(form.toolAllowlist);
	const selected = form.toolAllowlist ?? [];

	const toggleTool = (name: string, checked: boolean) => {
		const next = checked
			? [...selected, name]
			: selected.filter((value) => value !== name);
		set({ toolAllowlist: next });
	};

	return (
		<div className="flex flex-col gap-2 border-t pt-3">
			<p className="font-medium text-sm">Limit tools</p>
			<p className="text-muted-foreground text-xs">
				Only the selected tools are offered to the agent. Fewer tools = cheaper
				turns and better tool choice.
			</p>
			<ModeToggle
				mode={mode}
				onSelectAll={() => set({ toolAllowlist: null })}
				onSelectSome={() => set({ toolAllowlist: allToolNames(groups) })}
			/>
			{mode === "selected" ? (
				<div className="flex flex-col gap-3">
					{groups.map((group) => (
						<SourceGroupSection
							group={group}
							key={group.key}
							onToggle={toggleTool}
							selected={selected}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}
