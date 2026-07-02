// apps/admin/src/components/customers/use-customer-usage.ts

import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import type { WindowDays } from "./dashboard-constants";

export interface DayPoint {
	costCents: number;
	day: string;
	inputTokens: number;
	outputTokens: number;
	turns: number;
}

export interface UsageSummary {
	daily: DayPoint[];
	totals: {
		inputTokens: number;
		outputTokens: number;
		costCents: number;
		turns: number;
	};
}

/**
 * Build a continuous day axis for `windowDays` days ending today (inclusive).
 * Returns "YYYY-MM-DD" strings in ascending order.
 */
const ISO_DATE_LENGTH = 10;

function buildDayAxis(windowDays: number): string[] {
	const MS_PER_DAY = 86_400_000;
	const today = new Date();
	return Array.from({ length: windowDays }, (_, i) => {
		const d = new Date(today.getTime() - (windowDays - 1 - i) * MS_PER_DAY);
		return d.toISOString().slice(0, ISO_DATE_LENGTH);
	});
}

/**
 * Map sparse API rows onto the continuous day axis; missing days get zeros.
 */
function mergeDays(axis: string[], rows: DayPoint[]): DayPoint[] {
	const byDay = new Map(rows.map((r) => [r.day, r]));
	return axis.map(
		(day) =>
			byDay.get(day) ?? {
				day,
				inputTokens: 0,
				outputTokens: 0,
				costCents: 0,
				turns: 0,
			}
	);
}

export function useCustomerUsage(userId: string, windowDays: WindowDays) {
	const query = useQuery(
		orpc.admin.customerUsage.queryOptions({ input: { userId, windowDays } })
	);

	const raw = query.data;
	const axis = buildDayAxis(windowDays);
	const daily: DayPoint[] = raw ? mergeDays(axis, raw.daily) : [];
	const totals = raw?.totals ?? {
		inputTokens: 0,
		outputTokens: 0,
		costCents: 0,
		turns: 0,
	};

	return {
		isPending: query.isPending,
		isError: query.isError,
		error: query.error,
		daily,
		totals,
		isEmpty:
			!(query.isPending || query.isError) &&
			raw !== undefined &&
			raw.daily.length === 0,
	};
}
