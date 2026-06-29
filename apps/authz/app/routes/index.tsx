import { createFileRoute, redirect } from "@tanstack/react-router";
import { TOKEN_KEY } from "@/api";

export const Route = createFileRoute("/")({
	beforeLoad: () => {
		if (!localStorage.getItem(TOKEN_KEY)) {
			throw redirect({ to: "/login" });
		}
	},
	component: IndexPage,
});

function IndexPage() {
	return (
		<div className="authz-enter flex min-h-screen items-center justify-center">
			<h1 className="font-semibold text-2xl">authz admin</h1>
		</div>
	);
}
