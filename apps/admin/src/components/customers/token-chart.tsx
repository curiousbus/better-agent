// apps/admin/src/components/customers/token-chart.tsx

import { Skeleton } from "@better-agent/ui/components/skeleton";
import {
	CartesianGrid,
	Legend,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { COLOR_INPUT, COLOR_OUTPUT } from "./dashboard-constants";
import type { DayPoint } from "./use-customer-usage";

const CHART_HEIGHT = 256;
const TICK_FONT_SIZE = 12;
const LINE_STROKE_WIDTH = 2;

interface TokenChartProps {
	daily: DayPoint[];
	isPending: boolean;
}

interface ChartRow {
	day: string;
	Input: number;
	Output: number;
}

function formatDay(day: string): string {
	// "2024-07-01" → "Jul 1"
	const d = new Date(`${day}T00:00:00`);
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ChartSkeleton() {
	return <Skeleton className="h-64 w-full" />;
}

function ChartBody({ data }: { data: ChartRow[] }) {
	return (
		<ResponsiveContainer height={CHART_HEIGHT} width="100%">
			<LineChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
				<CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
				<XAxis
					dataKey="day"
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
				/>
				<YAxis
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
				/>
				<Tooltip
					contentStyle={{
						background: "var(--popover)",
						border: "1px solid var(--border)",
						borderRadius: "6px",
						fontSize: "12px",
					}}
				/>
				<Legend wrapperStyle={{ fontSize: "12px" }} />
				<Line
					dataKey="Input"
					dot={false}
					name="Input"
					stroke={COLOR_INPUT}
					strokeWidth={LINE_STROKE_WIDTH}
					type="monotone"
				/>
				<Line
					dataKey="Output"
					dot={false}
					name="Output"
					stroke={COLOR_OUTPUT}
					strokeWidth={LINE_STROKE_WIDTH}
					type="monotone"
				/>
			</LineChart>
		</ResponsiveContainer>
	);
}

export function TokenChart({ daily, isPending }: TokenChartProps) {
	if (isPending) {
		return <ChartSkeleton />;
	}
	const data = daily.map((d) => ({
		day: formatDay(d.day),
		Input: d.inputTokens,
		Output: d.outputTokens,
	}));
	return (
		<div className="rounded-lg border bg-card p-4 shadow-sm">
			<p className="mb-4 font-medium text-sm">Token Usage</p>
			<ChartBody data={data} />
		</div>
	);
}
