// apps/admin/src/components/customers/empty-state.tsx

import { BarChart2 } from "lucide-react";

export function EmptyState() {
	return (
		<div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
			<BarChart2 className="h-10 w-10 opacity-40" />
			<p className="font-medium text-base">No usage yet</p>
			<p className="max-w-xs text-sm">
				This customer has not used the assistant yet.
			</p>
		</div>
	);
}
