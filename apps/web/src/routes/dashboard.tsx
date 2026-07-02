// apps/web/src/routes/dashboard.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ActivityTimeline } from "@/components/dashboard/activity-timeline";
import {
	DEFAULT_WINDOW,
	type WindowDays,
} from "@/components/dashboard/dashboard-constants";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { TokenChart } from "@/components/dashboard/token-chart";
import { useUsageData } from "@/components/dashboard/use-usage-data";
import { WindowToggle } from "@/components/dashboard/window-toggle";

export const Route = createFileRoute("/dashboard")({
	component: DashboardPage,
});

function DashboardHeader({
	windowDays,
	onWindowChange,
}: {
	windowDays: WindowDays;
	onWindowChange: (w: WindowDays) => void;
}) {
	return (
		<div className="flex items-center justify-between">
			<h1 className="font-semibold text-lg">Usage</h1>
			<WindowToggle onChange={onWindowChange} value={windowDays} />
		</div>
	);
}

function DashboardBody({
	daily,
	isEmpty,
	isPending,
	totals,
}: {
	daily: ReturnType<typeof useUsageData>["daily"];
	isEmpty: boolean;
	isPending: boolean;
	totals: ReturnType<typeof useUsageData>["totals"];
}) {
	if (isEmpty) {
		return <EmptyState />;
	}
	return (
		<>
			<SummaryCards isPending={isPending} totals={totals} />
			<TokenChart daily={daily} isPending={isPending} />
		</>
	);
}

function DashboardPage() {
	const [windowDays, setWindowDays] = useState<WindowDays>(DEFAULT_WINDOW);
	const { isPending, isError, error, daily, totals, isEmpty } =
		useUsageData(windowDays);

	useEffect(() => {
		if (isError) {
			const message =
				error instanceof Error ? error.message : "Failed to load usage";
			toast.error(message);
		}
	}, [isError, error]);

	return (
		<div className="flex flex-col gap-6 p-4 sm:p-6">
			<DashboardHeader onWindowChange={setWindowDays} windowDays={windowDays} />
			<DashboardBody
				daily={daily}
				isEmpty={isEmpty}
				isPending={isPending}
				totals={totals}
			/>
			<ActivityTimeline />
		</div>
	);
}
