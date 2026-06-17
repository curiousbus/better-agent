import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sessions")({
	component: () => (
		<div>
			<h1 className="font-bold text-2xl">Sessions</h1>
			<p className="mt-2 text-muted-foreground text-sm">Coming soon.</p>
		</div>
	),
});
