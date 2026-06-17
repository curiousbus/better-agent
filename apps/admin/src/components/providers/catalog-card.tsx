import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ProviderCatalogRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

function CatalogTable({
	rows,
	loading,
}: {
	rows: ProviderCatalogRow[];
	loading: boolean;
}) {
	if (loading) {
		return <Skeleton className="h-24 w-full" />;
	}
	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No providers yet. Click "Refresh catalog".
			</p>
		);
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
					<tr className="border-b/40" key={row.providerId}>
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
		<Card className="p-4">
			<div className="mb-3 flex items-center justify-between">
				<h2 className="font-semibold text-lg">Provider catalog</h2>
				<Button
					disabled={refresh.isPending}
					onClick={() => refresh.mutate(undefined)}
					size="sm"
				>
					{refresh.isPending ? "Refreshing…" : "Refresh catalog"}
				</Button>
			</div>
			<CatalogTable loading={catalog.isLoading} rows={catalog.data ?? []} />
		</Card>
	);
}
