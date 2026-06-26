import { Checkbox } from "@better-agent/ui/components/checkbox";
import { Label } from "@better-agent/ui/components/label";
import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

export function ComposioAccountsField({
	selected,
	onChange,
}: {
	selected: string[];
	onChange: (ids: string[]) => void;
}) {
	const accounts = useQuery(orpc.composio.listAccounts.queryOptions());
	const rows = accounts.data ?? [];

	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No composio accounts yet. Add one on the Composio page to link tools.
			</p>
		);
	}

	const toggle = (id: string, checked: boolean) =>
		onChange(
			checked ? [...selected, id] : selected.filter((value) => value !== id)
		);

	return (
		<div className="flex flex-col gap-2">
			{rows.map((row) => (
				<Label className="flex items-center gap-2 font-normal" key={row.id}>
					<Checkbox
						checked={selected.includes(row.id)}
						onCheckedChange={(checked) => toggle(row.id, checked === true)}
					/>
					{row.name}
				</Label>
			))}
		</div>
	);
}
