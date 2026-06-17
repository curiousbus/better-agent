import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/agents")({
	component: () => (
		<div>
			<h1 className="font-bold text-2xl">Agents</h1>
			<p className="mt-2 text-muted-foreground text-sm">Coming soon.</p>
		</div>
	),
});
