import { Button } from "@better-agent/ui/components/button";

export function Pagination({
	page,
	pageCount,
	total,
	onPage,
}: {
	page: number;
	pageCount: number;
	total: number;
	onPage: (page: number) => void;
}) {
	return (
		<div className="flex items-center justify-between text-muted-foreground text-xs">
			<span>{total} items</span>
			<div className="flex items-center gap-2">
				<Button
					disabled={page <= 0}
					onClick={() => onPage(page - 1)}
					size="xs"
					variant="outline"
				>
					Prev
				</Button>
				<span>
					{page + 1} / {pageCount}
				</span>
				<Button
					disabled={page >= pageCount - 1}
					onClick={() => onPage(page + 1)}
					size="xs"
					variant="outline"
				>
					Next
				</Button>
			</div>
		</div>
	);
}
