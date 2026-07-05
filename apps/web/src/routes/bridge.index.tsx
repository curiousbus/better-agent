import { createFileRoute, redirect } from "@tanstack/react-router";

// The bridge UI moved to /local-agents (sidebar renamed "Local Agent") — this
// route only exists so old links/bookmarks to /bridge don't 404.
export const Route = createFileRoute("/bridge/")({
	beforeLoad: () => {
		throw redirect({ to: "/local-agents" });
	},
});
