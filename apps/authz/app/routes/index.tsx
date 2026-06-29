import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: IndexPage,
});

function IndexPage() {
	return (
		<div className="flex min-h-screen items-center justify-center">
			<h1 className="font-semibold text-2xl">authz admin</h1>
		</div>
	);
}
