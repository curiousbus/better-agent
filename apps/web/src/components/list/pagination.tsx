import {
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
	Pagination as PaginationRoot,
} from "@better-agent/ui/components/pagination";

// How many numbered buttons to show around the current page.
const WINDOW = 1;
const ELLIPSIS = -1;

// 0-based pages in, a compact list out: first … around-current … last.
function pageItems(page: number, pageCount: number): number[] {
	const pages = new Set<number>([0, pageCount - 1]);
	for (let p = page - WINDOW; p <= page + WINDOW; p++) {
		if (p >= 0 && p < pageCount) {
			pages.add(p);
		}
	}
	const sorted = [...pages].sort((a, b) => a - b);
	const items: number[] = [];
	let prev: number | null = null;
	for (const p of sorted) {
		if (prev !== null && p - prev > 1) {
			items.push(ELLIPSIS);
		}
		items.push(p);
		prev = p;
	}
	return items;
}

function PageNumbers({
	page,
	pageCount,
	onPage,
}: {
	page: number;
	pageCount: number;
	onPage: (page: number) => void;
}) {
	return (
		<>
			{pageItems(page, pageCount).map((item, index) =>
				item === ELLIPSIS ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: ellipsis slots are positional
					<PaginationItem key={`e-${index}`}>
						<PaginationEllipsis />
					</PaginationItem>
				) : (
					<PaginationItem key={item}>
						<PaginationLink
							isActive={item === page}
							onClick={() => onPage(item)}
						>
							{item + 1}
						</PaginationLink>
					</PaginationItem>
				)
			)}
		</>
	);
}

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
	if (pageCount <= 1) {
		return <p className="text-muted-foreground text-xs">{total} items</p>;
	}
	return (
		<div className="flex items-center justify-between gap-4">
			<span className="shrink-0 text-muted-foreground text-xs">
				{total} items
			</span>
			<PaginationRoot className="mx-0 w-auto justify-end">
				<PaginationContent>
					<PaginationItem>
						<PaginationPrevious
							disabled={page <= 0}
							onClick={() => onPage(page - 1)}
						/>
					</PaginationItem>
					<PageNumbers onPage={onPage} page={page} pageCount={pageCount} />
					<PaginationItem>
						<PaginationNext
							disabled={page >= pageCount - 1}
							onClick={() => onPage(page + 1)}
						/>
					</PaginationItem>
				</PaginationContent>
			</PaginationRoot>
		</div>
	);
}
