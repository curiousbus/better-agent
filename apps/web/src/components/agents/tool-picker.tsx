import { Button } from "@better-agent/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@better-agent/ui/components/dropdown-menu";
import { ChevronDownIcon } from "lucide-react";

import type { ToolGroup } from "./tool-allowlist-groups";

function GroupBulkActions({
	group,
	onToggleGroup,
}: {
	group: ToolGroup;
	onToggleGroup: (group: ToolGroup, checked: boolean) => void;
}) {
	return (
		<div className="flex gap-1 px-1 py-1">
			<DropdownMenuItem
				className="flex-1 justify-center"
				closeOnClick={false}
				onClick={() => onToggleGroup(group, true)}
			>
				Select all
			</DropdownMenuItem>
			<DropdownMenuItem
				className="flex-1 justify-center"
				closeOnClick={false}
				onClick={() => onToggleGroup(group, false)}
			>
				Clear
			</DropdownMenuItem>
		</div>
	);
}

// Level 2 of the cascade: the group's tools as checkbox rows. Submenu hover
// uses base-ui's built-in safe-polygon intent (the "safe triangle"), so
// diagonal cursor travel toward an open submenu never closes it.
export function GroupSubmenu({
	group,
	selected,
	onToggleTool,
	onToggleGroup,
}: {
	group: ToolGroup;
	selected: string[];
	onToggleTool: (name: string, checked: boolean) => void;
	onToggleGroup: (group: ToolGroup, checked: boolean) => void;
}) {
	const checkedCount = group.tools.filter((tool) =>
		selected.includes(tool.name)
	).length;
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<span className="flex-1 truncate">{group.label}</span>
				<span className="text-muted-foreground text-xs">
					{checkedCount}/{group.tools.length}
				</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="max-h-72 w-72 overflow-y-auto">
				<GroupBulkActions group={group} onToggleGroup={onToggleGroup} />
				{group.tools.map((tool) => (
					<DropdownMenuCheckboxItem
						checked={selected.includes(tool.name)}
						closeOnClick={false}
						key={tool.name}
						onCheckedChange={(checked) => onToggleTool(tool.name, checked)}
					>
						<span className="truncate font-mono text-xs">{tool.name}</span>
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

function ToolPickerTrigger({
	label,
	disabled,
}: {
	label: string;
	disabled: boolean;
}) {
	return (
		<DropdownMenuTrigger
			render={
				<Button
					className="w-full justify-between sm:w-80"
					disabled={disabled}
					size="sm"
					type="button"
					variant="outline"
				/>
			}
		>
			<span className="truncate">{label}</span>
			<ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
		</DropdownMenuTrigger>
	);
}

/**
 * Level 1 = purpose groups (composio tool-name prefixes, one group per MCP
 * server); level 2 = that group's tools. Patterned on the chat session
 * picker's cascading DropdownMenu.
 */
export function ToolPicker({
	groups,
	isPending,
	errors,
	selected,
	onToggleTool,
	onToggleGroup,
}: {
	groups: ToolGroup[];
	isPending: boolean;
	errors: Error[];
	selected: string[];
	onToggleTool: (name: string, checked: boolean) => void;
	onToggleGroup: (group: ToolGroup, checked: boolean) => void;
}) {
	const label = isPending
		? "Loading tools…"
		: `Configure tools — ${selected.length} selected`;
	return (
		<div className="flex flex-col gap-1.5">
			<DropdownMenu>
				<ToolPickerTrigger disabled={isPending} label={label} />
				<DropdownMenuContent align="start" className="w-72">
					{groups.map((group) => (
						<GroupSubmenu
							group={group}
							key={group.key}
							onToggleGroup={onToggleGroup}
							onToggleTool={onToggleTool}
							selected={selected}
						/>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			{errors.length > 0 ? (
				<p className="text-destructive text-xs">
					{errors.map((error) => error.message).join(" · ")}
				</p>
			) : null}
		</div>
	);
}
