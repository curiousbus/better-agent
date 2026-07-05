import { Skeleton } from "@better-agent/ui/components/skeleton";

/** Loading placeholder for LocalAgentDetail: header bar + terminal frame. */
export function LocalAgentDetailSkeleton() {
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
				<div className="flex flex-col gap-1.5">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-3 w-48" />
				</div>
				<Skeleton className="h-6 w-16 rounded-md" />
			</div>
			<Skeleton className="min-h-0 flex-1 rounded-lg" />
		</div>
	);
}
