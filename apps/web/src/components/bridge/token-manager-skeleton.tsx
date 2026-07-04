import { Skeleton } from "@better-agent/ui/components/skeleton";

const ROW_KEYS = ["r1", "r2", "r3"] as const;

function RowSkeleton() {
	return (
		<div className="flex items-center gap-4 py-3">
			<Skeleton className="h-4 w-28 flex-1" />
			<Skeleton className="h-4 w-24 flex-1" />
			<Skeleton className="h-4 w-20 flex-1" />
			<Skeleton className="size-6 shrink-0 rounded-md" />
		</div>
	);
}

/** Loading placeholder for TokenManager: toolbar + table-shaped rows. */
export function TokenManagerSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<Skeleton className="h-4 w-72" />
				<Skeleton className="h-8 w-24" />
			</div>
			<div className="flex flex-col divide-y">
				{ROW_KEYS.map((key) => (
					<RowSkeleton key={key} />
				))}
			</div>
		</div>
	);
}
