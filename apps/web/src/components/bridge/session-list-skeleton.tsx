import { Skeleton } from "@better-agent/ui/components/skeleton";

const ROW_KEYS = ["r1", "r2", "r3"] as const;

/** Loading placeholder for SessionList. */
export function SessionListSkeleton() {
	return (
		<div className="flex flex-col gap-1">
			{ROW_KEYS.map((key) => (
				<div
					className="flex items-center justify-between gap-2 px-2.5 py-2"
					key={key}
				>
					<div className="flex flex-1 flex-col gap-1">
						<Skeleton className="h-4 w-32" />
						<Skeleton className="h-3 w-40" />
					</div>
					<Skeleton className="h-6 w-12 rounded-md" />
				</div>
			))}
		</div>
	);
}
