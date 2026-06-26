import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/tools")({
	component: ToolsPage,
});

function ToolsPage() {
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto p-6">
			<div className="flex flex-col gap-1">
				<h1 className="font-semibold text-lg">Tools</h1>
				<p className="text-muted-foreground text-sm">
					Composio tools are now configured per user account.
				</p>
			</div>
		</div>
	);
}
