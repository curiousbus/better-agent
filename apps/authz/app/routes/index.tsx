import { createFileRoute, redirect } from "@tanstack/react-router";
import { TOKEN_KEY } from "@/api";
import { AppShell } from "@/components/app-shell";

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
		<AppShell>
			<div className="authz-enter flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
				<h1 className="font-semibold text-2xl">authz admin</h1>
			</div>
		</AppShell>
	);
}
