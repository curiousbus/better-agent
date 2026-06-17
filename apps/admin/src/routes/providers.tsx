import { createFileRoute } from "@tanstack/react-router";

import { CatalogCard } from "@/components/providers/catalog-card";
import { CredentialsCard } from "@/components/providers/credentials-card";
import { ModelsCard } from "@/components/providers/models-card";

export const Route = createFileRoute("/providers")({
	component: ProvidersPage,
});

function ProvidersPage() {
	return (
		<div className="flex flex-col gap-6">
			<h1 className="font-bold text-2xl">Providers</h1>
			<CatalogCard />
			<CredentialsCard />
			<ModelsCard />
		</div>
	);
}
