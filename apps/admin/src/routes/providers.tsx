import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@better-agent/ui/components/tabs";
import { createFileRoute } from "@tanstack/react-router";

import { CatalogCard } from "@/components/providers/catalog-card";
import { CredentialsCard } from "@/components/providers/credentials-card";
import { ModelsCard } from "@/components/providers/models-card";

export const Route = createFileRoute("/providers")({
	component: ProvidersPage,
});

function ProvidersPage() {
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 overflow-auto p-6">
			<Tabs defaultValue="credentials">
				<TabsList>
					<TabsTrigger value="credentials">Credentials</TabsTrigger>
					<TabsTrigger value="catalog">Catalog</TabsTrigger>
					<TabsTrigger value="models">Models</TabsTrigger>
				</TabsList>
				<TabsContent value="credentials">
					<CredentialsCard />
				</TabsContent>
				<TabsContent value="catalog">
					<CatalogCard />
				</TabsContent>
				<TabsContent value="models">
					<ModelsCard />
				</TabsContent>
			</Tabs>
		</div>
	);
}
