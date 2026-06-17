import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/providers")({
	component: ProvidersPage,
});

function ProvidersPage() {
	return <h1 className="font-bold text-2xl">Providers</h1>;
}
