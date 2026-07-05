import { Button } from "@better-agent/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@better-agent/ui/components/dropdown-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, WrenchIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { agentRowToForm, toAgentInput } from "@/components/agents/agent-form";
import {
	allToolNames,
	type ToolGroup,
	useToolSources,
} from "@/components/agents/tool-allowlist-groups";
import { GroupSubmenu } from "@/components/agents/tool-picker";
import type { AgentRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

function useSaveAllowlist() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.agents.update.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.agents.tools.key() });
			queryClient.invalidateQueries({ queryKey: orpc.agents.list.key() });
			toast.success("Agent tools updated");
		},
		onError: (error) => toast.error(error.message),
	});
}

// null allowlist = every tool. The menu shows everything CHECKED in that case;
// unchecking narrows to a list, re-checking everything folds back to null.
function useAllowlistState(agent: AgentRow, groups: ToolGroup[]) {
	const [allowlist, setAllowlist] = useState<string[] | null>(
		agent.toolAllowlist ?? null
	);
	const [dirty, setDirty] = useState(false);
	const names = allToolNames(groups);
	const selected = allowlist ?? names;
	const setList = (next: string[]) => {
		setAllowlist(next.length === names.length ? null : next);
		setDirty(true);
	};
	return {
		allowlist,
		dirty,
		clearDirty: () => setDirty(false),
		selected,
		toggleTool: (name: string, checked: boolean) =>
			setList(
				checked ? [...selected, name] : selected.filter((n) => n !== name)
			),
		toggleGroup: (group: ToolGroup, checked: boolean) => {
			const groupNames = group.tools.map((tool) => tool.name);
			setList(
				checked
					? [...new Set([...selected, ...groupNames])]
					: selected.filter((name) => !groupNames.includes(name))
			);
		},
	};
}

function MenuBody({
	groups,
	isPending,
	state,
}: {
	groups: ToolGroup[];
	isPending: boolean;
	state: ReturnType<typeof useAllowlistState>;
}) {
	if (isPending) {
		return (
			<div className="flex items-center gap-2 px-2 py-3 text-muted-foreground text-xs">
				<Loader2Icon className="size-3.5 animate-spin" />
				Loading tools…
			</div>
		);
	}
	if (groups.length === 0) {
		return (
			<div className="px-2 py-3 text-muted-foreground text-xs">0 tools</div>
		);
	}
	return (
		<>
			{groups.map((group) => (
				<GroupSubmenu
					group={group}
					key={group.key}
					onToggleGroup={state.toggleGroup}
					onToggleTool={state.toggleTool}
					selected={state.selected}
				/>
			))}
		</>
	);
}

/**
 * Composer control: which tools this agent runs with. Purpose groups cascade
 * into checkbox lists (base-ui safe-polygon hover); everything is checked when
 * no allowlist is set. Changes batch and save when the menu closes.
 */
export function AgentToolsMenu({ agent }: { agent: AgentRow }) {
	const { groups, isPending } = useToolSources(
		agent.composioAccountIds ?? [],
		agent.mcpServerIds ?? []
	);
	const state = useAllowlistState(agent, groups);
	const save = useSaveAllowlist();

	const persist = () => {
		if (!state.dirty) {
			return;
		}
		state.clearDirty();
		const form = { ...agentRowToForm(agent), toolAllowlist: state.allowlist };
		save.mutate({ id: agent.id, ...toAgentInput(form) });
	};

	return (
		<DropdownMenu onOpenChange={(open) => !open && persist()}>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label="Agent tools"
						size="icon-sm"
						title="Agent tools"
						type="button"
						variant="ghost"
					/>
				}
			>
				<WrenchIcon className="size-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				className="w-[calc(100vw-2rem)] max-w-72"
			>
				<MenuBody groups={groups} isPending={isPending} state={state} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
