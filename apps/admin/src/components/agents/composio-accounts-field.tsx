import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";
import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

// An agent links at most ONE composio account. Stored as a string[] (0 or 1
// items) so the backend stays uniform, but the UI is a single-select.
const NONE = "none";

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

	return (
		<Select
			onValueChange={(next) => {
				const value = typeof next === "string" ? next : NONE;
				onChange(value === NONE ? [] : [value]);
			}}
			value={selected[0] ?? NONE}
		>
			<SelectTrigger className="w-full" id="agent-composio">
				<SelectValue placeholder="No composio account" />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value={NONE}>None</SelectItem>
				{rows.map((row) => (
					<SelectItem key={row.id} value={row.id}>
						{row.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
