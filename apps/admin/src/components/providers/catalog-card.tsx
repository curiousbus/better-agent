import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { useListView } from "@/components/list/use-list-view";
import type { ProviderCatalogRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

function matchProvider(row: ProviderCatalogRow, query: string): boolean {
	return (
		row.providerId.toLowerCase().includes(query) ||
		row.name.toLowerCase().includes(query)
	);
}

function CatalogTable({ rows }: { rows: ProviderCatalogRow[] }) {
	if (rows.length === 0) {
		return <p className="text-muted-foreground text-sm">No providers.</p>;
	}
	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-b text-left text-muted-foreground">
					<th className="py-1 font-medium">Provider</th>
					<th className="font-medium">Name</th>
					<th className="font-medium">npm</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr className="border-border/40 border-b" key={row.providerId}>
						<td className="py-1 font-mono">{row.providerId}</td>
						<td>{row.name}</td>
						<td className="text-muted-foreground">{row.npm ?? "—"}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

export function CatalogCard() {
	const queryClient = useQueryClient();
	const catalog = useQuery(orpc.providers.catalogList.queryOptions());
	const view = useListView(catalog.data ?? [], { filter: matchProvider });
	const refresh = useMutation(
		orpc.providers.catalogRefresh.mutationOptions({
			onSuccess: () => {
				toast.success("Catalog refreshed");
				queryClient.invalidateQueries({
					queryKey: orpc.providers.catalogList.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);

	return (
		<Card className="flex flex-col gap-3 p-4">
			<h2 className="font-semibold text-lg">Provider catalog</h2>
			<ListToolbar
				action={
					<Button
						disabled={refresh.isPending}
						onClick={() => refresh.mutate(undefined)}
						size="sm"
					>
						{refresh.isPending ? "Refreshing…" : "Refresh catalog"}
					</Button>
				}
				onSearch={view.setSearch}
				placeholder="Search providers…"
				search={view.search}
			/>
			{catalog.isLoading ? (
				<Skeleton className="h-24 w-full" />
			) : (
				<CatalogTable rows={view.pageRows} />
			)}
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={view.pageCount}
				total={view.total}
			/>
		</Card>
	);
}
