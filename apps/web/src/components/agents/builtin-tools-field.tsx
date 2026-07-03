import {
	BUILTIN_TOOLS,
	type BuiltinToolMeta,
} from "@better-agent/agent/tool/builtin-tools";
import { Checkbox } from "@better-agent/ui/components/checkbox";
import { Label } from "@better-agent/ui/components/label";

function groupByCategory(): [string, BuiltinToolMeta[]][] {
	const groups = new Map<string, BuiltinToolMeta[]>();
	for (const tool of BUILTIN_TOOLS) {
		const list = groups.get(tool.category) ?? [];
		list.push(tool);
		groups.set(tool.category, list);
	}
	return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function ToolRow({
	tool,
	checked,
	onToggle,
}: {
	tool: BuiltinToolMeta;
	checked: boolean;
	onToggle: (id: string, checked: boolean) => void;
}) {
	return (
		<Label className="flex items-start gap-2 font-normal">
			<Checkbox
				checked={checked}
				onCheckedChange={(next) => onToggle(tool.id, next === true)}
			/>
			<span className="flex flex-col">
				<span>{tool.label}</span>
				<span className="text-muted-foreground text-xs">
					{tool.description}
				</span>
			</span>
		</Label>
	);
}

/** All built-in tools, grouped by category, each checkable. */
export function BuiltinToolsField({
	selected,
	onChange,
}: {
	selected: string[];
	onChange: (ids: string[]) => void;
}) {
	const toggle = (id: string, checked: boolean) =>
		onChange(
			checked ? [...selected, id] : selected.filter((value) => value !== id)
		);

	return (
		<div className="flex flex-col gap-4">
			{groupByCategory().map(([category, tools]) => (
				<div className="flex flex-col gap-2" key={category}>
					<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
						{category}
					</p>
					{tools.map((tool) => (
						<ToolRow
							checked={selected.includes(tool.id)}
							key={tool.id}
							onToggle={toggle}
							tool={tool}
						/>
					))}
				</div>
			))}
		</div>
	);
}
