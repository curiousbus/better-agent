import { Skeleton } from "@better-agent/ui/components/skeleton";

const ROW_KEYS = ["r1", "r2", "r3"] as const;
const TOOLKIT_ROW_KEYS = ["t1", "t2", "t3", "t4", "t5"] as const;

function AccountRowSkeleton() {
	return (
		<div className="flex items-center gap-4 py-3">
			<Skeleton className="h-4 w-32 flex-1" />
			<Skeleton className="h-4 w-24 flex-1" />
			<Skeleton className="h-4 w-24 flex-1" />
			<Skeleton className="ml-auto size-6 rounded-md" />
		</div>
	);
}

// Mirrors the accounts view: search toolbar + Add button, then table-shaped
// rows (name / masked key / created / delete action).
export function AccountsSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<Skeleton className="h-9 w-full max-w-xs" />
				<Skeleton className="h-8 w-28" />
			</div>
			<div className="flex flex-col divide-y">
				{ROW_KEYS.map((key) => (
					<AccountRowSkeleton key={key} />
				))}
			</div>
		</div>
	);
}

function SectionSkeleton({ rowCount }: { rowCount: number }) {
	const keys = TOOLKIT_ROW_KEYS.slice(0, rowCount);
	return (
		<div className="flex flex-col gap-2">
			<Skeleton className="h-4 w-40" />
			<div className="rounded-lg border">
				<div className="flex flex-col divide-y p-3">
					{keys.map((key) => (
						<div className="flex items-center gap-4 py-2" key={key}>
							<Skeleton className="h-4 w-32 flex-1" />
							<Skeleton className="h-4 w-20 flex-1" />
							<Skeleton className="ml-auto h-6 w-16 rounded-md" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

// Mirrors the account detail view: heading then the merged toolkit table,
// shaped as a bordered row list.
export function AccountDetailSkeleton() {
	return (
		<div className="flex flex-col gap-4">
			<Skeleton className="h-5 w-40" />
			<SectionSkeleton rowCount={5} />
		</div>
	);
}
