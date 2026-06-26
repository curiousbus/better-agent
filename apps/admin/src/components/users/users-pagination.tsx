import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "@better-agent/ui/components/pagination";

const MAX_INLINE_PAGES = 7;
const SECOND_PAGE = 2;

interface PageItem {
	key: string;
	page: number | null;
}

function buildPageItems(current: number, total: number): PageItem[] {
	if (total <= MAX_INLINE_PAGES) {
		return Array.from({ length: total }, (_, index) => ({
			key: `p${index + 1}`,
			page: index + 1,
		}));
	}
	const start = Math.max(SECOND_PAGE, current - 1);
	const end = Math.min(total - 1, current + 1);
	const middle = Array.from({ length: end - start + 1 }, (_, index) => ({
		key: `p${start + index}`,
		page: start + index,
	}));
	return [
		{ key: "p1", page: 1 },
		...(start > SECOND_PAGE ? [{ key: "gap-start", page: null }] : []),
		...middle,
		...(end < total - 1 ? [{ key: "gap-end", page: null }] : []),
		{ key: `p${total}`, page: total },
	];
}

export function UsersPagination({
	page,
	totalPages,
	onPage,
}: {
	page: number;
	totalPages: number;
	onPage: (page: number) => void;
}) {
	if (totalPages <= 1) {
		return null;
	}
	return (
		<Pagination>
			<PaginationContent>
				<PaginationItem>
					<PaginationPrevious
						disabled={page <= 1}
						onClick={() => onPage(page - 1)}
					/>
				</PaginationItem>
				{buildPageItems(page, totalPages).map((item) => {
					const target = item.page;
					return (
						<PaginationItem key={item.key}>
							{target === null ? (
								<PaginationEllipsis />
							) : (
								<PaginationLink
									isActive={target === page}
									onClick={() => onPage(target)}
								>
									{target}
								</PaginationLink>
							)}
						</PaginationItem>
					);
				})}
				<PaginationItem>
					<PaginationNext
						disabled={page >= totalPages}
						onClick={() => onPage(page + 1)}
					/>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	);
}
