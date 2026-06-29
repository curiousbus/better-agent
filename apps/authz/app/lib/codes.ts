import type { Code } from "../api";

export const PAGE_SIZE = 10;

export function filterCodes(codes: Code[], query: string): Code[] {
	const q = query.toLowerCase();
	if (q === "") {
		return codes;
	}
	return codes.filter(
		(c) =>
			c.code.toLowerCase().includes(q) ||
			c.label.toLowerCase().includes(q) ||
			c.source.toLowerCase().includes(q)
	);
}

export function pageOf<T>(items: T[], page: number): T[] {
	const start = page * PAGE_SIZE;
	return items.slice(start, start + PAGE_SIZE);
}

export function pageCount(total: number): number {
	return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

export function clampPage(page: number, total: number): number {
	const max = pageCount(total) - 1;
	if (page < 0) {
		return 0;
	}
	if (page > max) {
		return max;
	}
	return page;
}
