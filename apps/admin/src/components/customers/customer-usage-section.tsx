// apps/admin/src/components/customers/customer-usage-section.tsx

import { useState } from "react";
import { DEFAULT_WINDOW, type WindowDays } from "./dashboard-constants";
import { EmptyState } from "./empty-state";
import { SummaryCards } from "./summary-cards";
import { TokenChart } from "./token-chart";
import { useCustomerUsage } from "./use-customer-usage";
import { WindowToggle } from "./window-toggle";

export function CustomerUsageSection({ userId }: { userId: string }) {
	const [windowDays, setWindowDays] = useState<WindowDays>(DEFAULT_WINDOW);
	const usage = useCustomerUsage(userId, windowDays);

	return (
		<section className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<h2 className="font-semibold text-base">AI Usage</h2>
				<WindowToggle onChange={setWindowDays} value={windowDays} />
			</div>
			{usage.isEmpty ? (
				<EmptyState />
			) : (
				<>
					<SummaryCards isPending={usage.isPending} totals={usage.totals} />
					<TokenChart daily={usage.daily} isPending={usage.isPending} />
				</>
			)}
		</section>
	);
}
