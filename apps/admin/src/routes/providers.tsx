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
			<div className="flex flex-col gap-1">
				<h1 className="font-bold text-2xl">Providers</h1>
				<p className="text-muted-foreground text-sm">
					Manage provider credentials and browse the models.dev catalog.
				</p>
			</div>
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
