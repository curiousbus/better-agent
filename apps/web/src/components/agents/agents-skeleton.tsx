import { Skeleton } from "@better-agent/ui/components/skeleton";

const ROW_KEYS = ["r1", "r2", "r3", "r4"] as const;
const ACTION_KEYS = ["a1", "a2", "a3", "a4"] as const;

function RowSkeleton() {
	return (
		<div className="flex items-center gap-4 py-3">
			<div className="flex flex-1 items-center gap-2">
				<Skeleton className="size-6 shrink-0 rounded-full" />
				<Skeleton className="h-4 w-28" />
			</div>
			<Skeleton className="h-4 w-40 flex-1" />
			<Skeleton className="h-5 w-32 flex-1 rounded" />
			<div className="flex flex-1 justify-end gap-1.5">
				{ACTION_KEYS.map((key) => (
					<Skeleton className="size-6 rounded-md" key={key} />
				))}
			</div>
		</div>
	);
}

// Mirrors the agents view: search toolbar + Add button, then table-shaped rows
// (avatar + name / model / token / icon actions).
export function AgentsSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<Skeleton className="h-9 w-full max-w-xs" />
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
