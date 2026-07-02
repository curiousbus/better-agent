import { Checkbox } from "@better-agent/ui/components/checkbox";
import { Label } from "@better-agent/ui/components/label";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";

export function McpServersField({
	selected,
	onChange,
}: {
	selected: string[];
	onChange: (ids: string[]) => void;
}) {
	const servers = useQuery(orpc.mcp.listServers.queryOptions());
	const rows = servers.data ?? [];

	const toggle = (id: string, checked: boolean) =>
		onChange(
			checked ? [...selected, id] : selected.filter((value) => value !== id)
		);

	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No MCP servers yet.{" "}
				<Link className="underline hover:text-foreground" to="/integrations">
					Add one in Integrations
				</Link>
				.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			{rows.map((row) => (
				<Label className="flex items-start gap-2 font-normal" key={row.id}>
					<Checkbox
						checked={selected.includes(row.id)}
						onCheckedChange={(checked) => toggle(row.id, checked === true)}
					/>
					<span className="flex flex-col">
						<span>{row.name}</span>
						<span className="text-muted-foreground text-xs">{row.url}</span>
					</span>
				</Label>
			))}
		</div>
	);
}
