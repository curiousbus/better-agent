import { Card } from "@better-agent/ui/components/card";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { useListView } from "@/components/list/use-list-view";
import type { ModelRow, ProviderCatalogRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

function matchModel(row: ModelRow, query: string): boolean {
	return (
		row.modelId.toLowerCase().includes(query) ||
		row.name.toLowerCase().includes(query)
	);
}

function ProviderPicker({
	providers,
	value,
	onChange,
}: {
	providers: ProviderCatalogRow[];
	value: string;
	onChange: (providerId: string) => void;
}) {
	return (
		<select
			aria-label="Provider"
			className="h-8 border bg-transparent px-2 text-sm"
			onChange={(event) => onChange(event.target.value)}
			value={value}
		>
			<option value="">Select a provider…</option>
			{providers.map((provider) => (
				<option key={provider.providerId} value={provider.providerId}>
					{provider.providerId}
				</option>
			))}
		</select>
	);
}

function ModelsTable({ rows }: { rows: ModelRow[] }) {
	if (rows.length === 0) {
		return <p className="text-muted-foreground text-sm">No models.</p>;
	}
	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-b text-left text-muted-foreground">
					<th className="py-1 font-medium">Model</th>
					<th className="font-medium">Name</th>
					<th className="font-medium">Context</th>
					<th className="font-medium">Tools</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr className="border-b/40" key={row.modelId}>
						<td className="py-1 font-mono">{row.modelId}</td>
						<td>{row.name}</td>
						<td className="text-muted-foreground">{row.contextLimit ?? "—"}</td>
						<td className="text-muted-foreground">
							{row.capabilities.toolCall ? "yes" : "no"}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

export function ModelsCard() {
	const [providerId, setProviderId] = useState("");
	const catalog = useQuery(orpc.providers.catalogList.queryOptions());
	const models = useQuery(
		orpc.providers.modelsList.queryOptions({
			input: { providerId },
			enabled: providerId !== "",
		})
	);
	const view = useListView(models.data ?? [], { filter: matchModel });

	return (
		<Card className="flex flex-col gap-3 p-4">
			<h2 className="font-semibold text-lg">Models</h2>
			<ListToolbar
				action={
					<ProviderPicker
						onChange={setProviderId}
						providers={catalog.data ?? []}
						value={providerId}
					/>
				}
				onSearch={view.setSearch}
				placeholder="Search models…"
				search={view.search}
			/>
			{providerId === "" ? (
				<p className="text-muted-foreground text-sm">
					Pick a provider to list its models.
				</p>
			) : (
				<>
					{models.isLoading ? (
						<Skeleton className="h-24 w-full" />
					) : (
						<ModelsTable rows={view.pageRows} />
					)}
					<Pagination
						onPage={view.setPage}
						page={view.page}
						pageCount={view.pageCount}
						total={view.total}
					/>
				</>
			)}
		</Card>
	);
}
