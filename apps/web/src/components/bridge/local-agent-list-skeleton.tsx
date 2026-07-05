import { Skeleton } from "@better-agent/ui/components/skeleton";

const CARD_KEYS = ["c1", "c2", "c3"] as const;

/** Loading placeholder for LocalAgentList: card-shaped rows. */
export function LocalAgentListSkeleton() {
	return (
		<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
			{CARD_KEYS.map((key) => (
				<div
					className="flex items-center justify-between gap-3 rounded-xl border p-4"
					key={key}
				>
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<Skeleton className="h-4 w-28" />
						<Skeleton className="h-3 w-40" />
					</div>
					<Skeleton className="h-5 w-14 rounded-md" />
				</div>
			))}
		</div>
	);
}
