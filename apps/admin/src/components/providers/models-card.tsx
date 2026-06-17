import { Card } from "@better-agent/ui/components/card";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { ModelRow, ProviderCatalogRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

function ModelsTable({
	rows,
	loading,
}: {
	rows: ModelRow[];
	loading: boolean;
}) {
	if (loading) {
		return <Skeleton className="h-24 w-full" />;
	}
	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No models for this provider.
			</p>
		);
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

export function ModelsCard() {
	const [providerId, setProviderId] = useState("");
	const catalog = useQuery(orpc.providers.catalogList.queryOptions());
	const models = useQuery(
		orpc.providers.modelsList.queryOptions({
			input: { providerId },
			enabled: providerId !== "",
		})
	);

	return (
		<Card className="flex flex-col gap-3 p-4">
			<div className="flex items-center justify-between">
				<h2 className="font-semibold text-lg">Models</h2>
				<ProviderPicker
					onChange={setProviderId}
					providers={catalog.data ?? []}
					value={providerId}
				/>
			</div>
			{providerId === "" ? (
				<p className="text-muted-foreground text-sm">
					Pick a provider to list its models.
				</p>
			) : (
				<ModelsTable loading={models.isLoading} rows={models.data ?? []} />
			)}
		</Card>
	);
}
