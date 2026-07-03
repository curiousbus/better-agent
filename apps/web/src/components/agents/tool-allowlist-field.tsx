import { Button } from "@better-agent/ui/components/button";

import type { AgentForm } from "./agent-form";
import {
	allToolNames,
	type Mode,
	modeOf,
	useToolSources,
	useToolToggles,
} from "./tool-allowlist-groups";
import { ToolPicker } from "./tool-picker";

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
	const { groups, isPending, errors } = useToolSources(
		form.composioAccountIds,
		form.mcpServerIds
	);
	const mode = modeOf(form.toolAllowlist);
	const selected = form.toolAllowlist ?? [];
	const { toggleTool, toggleGroup } = useToolToggles(selected, set);

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
				<ToolPicker
					errors={errors}
					groups={groups}
					isPending={isPending}
					onToggleGroup={toggleGroup}
					onToggleTool={toggleTool}
					selected={selected}
				/>
			) : null}
		</div>
	);
}
