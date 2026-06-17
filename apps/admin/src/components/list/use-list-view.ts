import { useMemo, useState } from "react";

const DEFAULT_PAGE_SIZE = 10;

export interface ListView<T> {
	page: number;
	pageCount: number;
	pageRows: T[];
	search: string;
	setPage: (page: number) => void;
	setSearch: (value: string) => void;
	total: number;
}

export function useListView<T>(
	rows: T[],
	options: { filter: (row: T, query: string) => boolean; pageSize?: number }
): ListView<T> {
	const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
	const [search, setSearchState] = useState("");
	const [page, setPage] = useState(0);

	const filtered = useMemo(
		() =>
			rows.filter((row) => options.filter(row, search.trim().toLowerCase())),
		[rows, search, options.filter]
	);
	const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
	const clampedPage = Math.min(page, pageCount - 1);
	const pageRows = filtered.slice(
		clampedPage * pageSize,
		clampedPage * pageSize + pageSize
	);

	const setSearch = (value: string) => {
		setSearchState(value);
		setPage(0);
	};

	return {
		search,
		setSearch,
		page: clampedPage,
		setPage,
		pageRows,
		pageCount,
		total: filtered.length,
	};
}
