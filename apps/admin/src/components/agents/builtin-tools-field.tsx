import { Checkbox } from "@better-agent/ui/components/checkbox";
import { Label } from "@better-agent/ui/components/label";

// Keep in sync with BUILTIN_TOOLS in packages/agent/src/tool/builtin-tools.ts.
const BUILTIN_TOOLS = [
	{
		id: "get_current_time",
		label: "Current time",
		description: "Returns the current UTC date and time.",
	},
];

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
		<div className="flex flex-col gap-2">
			{BUILTIN_TOOLS.map((tool) => (
				<Label className="flex items-start gap-2 font-normal" key={tool.id}>
					<Checkbox
						checked={selected.includes(tool.id)}
						onCheckedChange={(checked) => toggle(tool.id, checked === true)}
					/>
					<span className="flex flex-col">
						<span>{tool.label}</span>
						<span className="text-muted-foreground text-xs">
							{tool.description}
						</span>
					</span>
				</Label>
			))}
		</div>
	);
}
