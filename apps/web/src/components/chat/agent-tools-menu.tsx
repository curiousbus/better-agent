import { Button } from "@better-agent/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@better-agent/ui/components/dropdown-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WrenchIcon } from "lucide-react";
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

function useAllowlistState(agent: AgentRow, groups: ToolGroup[]) {
	const [allowlist, setAllowlist] = useState<string[] | null>(
		agent.toolAllowlist ?? null
	);
	const [dirty, setDirty] = useState(false);
	const selected = allowlist ?? [];
	const setList = (next: string[] | null) => {
		setAllowlist(next);
		setDirty(true);
	};
	return {
		allowlist,
		dirty,
		clearDirty: () => setDirty(false),
		useAll: allowlist === null,
		selected,
		toggleAll: (checked: boolean) =>
			setList(checked ? null : allToolNames(groups)),
		toggleTool: (name: string, checked: boolean) =>
			setList(
				checked ? [...selected, name] : selected.filter((n) => n !== name)
			),
		toggleGroup: (group: ToolGroup, checked: boolean) => {
			const names = group.tools.map((tool) => tool.name);
			setList(
				checked
					? [...new Set([...selected, ...names])]
					: selected.filter((name) => !names.includes(name))
			);
		},
	};
}

/**
 * Composer control: configure which tools this agent runs with. Level 1 =
 * purpose groups, level 2 = checkbox items (base-ui safe-polygon hover).
 * Changes are batched and saved when the menu closes.
 */
export function AgentToolsMenu({ agent }: { agent: AgentRow }) {
	const { groups, isPending, errors } = useToolSources(
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
			<ToolsMenuContent
				errors={errors}
				groups={groups}
				isPending={isPending}
				state={state}
			/>
		</DropdownMenu>
	);
}

function ToolsMenuContent({
	state,
	groups,
	isPending,
	errors,
}: {
	state: ReturnType<typeof useAllowlistState>;
	groups: ToolGroup[];
	isPending: boolean;
	errors: Error[];
}) {
	return (
		<DropdownMenuContent align="start" className="w-72">
			<DropdownMenuLabel>Agent tools</DropdownMenuLabel>
			<DropdownMenuCheckboxItem
				checked={state.useAll}
				closeOnClick={false}
				onCheckedChange={state.toggleAll}
			>
				Use all tools
			</DropdownMenuCheckboxItem>
			<DropdownMenuSeparator />
			<MenuHints isPending={isPending} useAll={state.useAll} />
			{state.useAll
				? null
				: groups.map((group) => (
						<GroupSubmenu
							group={group}
							key={group.key}
							onToggleGroup={state.toggleGroup}
							onToggleTool={state.toggleTool}
							selected={state.selected}
						/>
					))}
			{errors.length > 0 ? (
				<DropdownMenuLabel className="font-normal text-destructive text-xs">
					{errors.map((error) => error.message).join(" · ")}
				</DropdownMenuLabel>
			) : null}
		</DropdownMenuContent>
	);
}

function MenuHints({
	isPending,
	useAll,
}: {
	isPending: boolean;
	useAll: boolean;
}) {
	if (isPending) {
		return (
			<DropdownMenuLabel className="text-muted-foreground">
				Loading tools…
			</DropdownMenuLabel>
		);
	}
	if (useAll) {
		return (
			<DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
				Every tool from the linked sources is offered. Uncheck to pick
				individually.
			</DropdownMenuLabel>
		);
	}
	return null;
}
