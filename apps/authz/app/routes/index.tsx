import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { listCodes, TOKEN_KEY, UnauthorizedError } from "@/api";
import { AppShell } from "@/components/app-shell";
import { CodesTable } from "@/components/codes-table";

export const Route = createFileRoute("/")({
	beforeLoad: () => {
		if (!localStorage.getItem(TOKEN_KEY)) {
			throw redirect({ to: "/login" });
		}
	},
	component: IndexPage,
});

function SkeletonRows() {
	return (
		<div className="space-y-2 py-4">
			{[0, 1, 2, 3, 4].map((i) => (
				<Skeleton className="h-8 w-full" key={i} />
			))}
		</div>
	);
}

function IndexPage() {
	const navigate = useNavigate();
	const token = localStorage.getItem(TOKEN_KEY);

	const q = useQuery({
		queryKey: ["codes"],
		queryFn: () => listCodes(token),
	});

	useEffect(() => {
		if (q.error instanceof UnauthorizedError) {
			localStorage.removeItem(TOKEN_KEY);
			navigate({ to: "/login" });
		}
	}, [q.error, navigate]);

	return (
		<AppShell>
			<div className="py-4">
				{q.isPending && <SkeletonRows />}
				{q.isError && !(q.error instanceof UnauthorizedError) && (
					<div className="flex flex-col items-center gap-3 py-8 text-destructive text-sm">
						<span>Failed to load codes: {q.error.message}</span>
						<button
							className="underline underline-offset-4"
							onClick={() => q.refetch()}
							type="button"
						>
							Retry
						</button>
					</div>
				)}
				{q.isSuccess && (
					<CodesTable codes={q.data} onRevoke={() => undefined} />
				)}
			</div>
		</AppShell>
	);
}
