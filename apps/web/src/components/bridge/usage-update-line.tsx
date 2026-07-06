import type { UsageUpdateDetail } from "./bridge-session-status";
import { formatContextUsage, formatCostUsd } from "./bridge-usage-format";

/** Cost figure from opencode's `usage_update` — `amount` + ISO `currency`. The
 * plan's example output (`$0.045`) treats it as USD; a non-USD currency falls
 * back to a plain `amount + code` so nothing is silently mislabeled. */
function formatUsageCost(amount: number, currency: string): string {
	return currency === "USD" ? formatCostUsd(amount) : `${amount} ${currency}`;
}

export interface UsageUpdateLineProps {
	/** The latest `usage_update` detail, or `null` before one has arrived —
	 * renders nothing until then. */
	detail: UsageUpdateDetail | null;
}

/**
 * opencode's streamed per-turn context/cost, rendered as a single small,
 * faded line right-aligned above the composer — e.g.
 * `48k/200k tok · 24% · $0.045`. The context % is derived client-side as
 * `used/size`. Distinct from the (claude) `turn_usage` stat grid: opencode
 * never emits `turn_usage`, only these live `usage_update` frames. Metadata,
 * not a chat message.
 */
export function UsageUpdateLine({ detail }: UsageUpdateLineProps) {
	if (!detail) {
		return null;
	}
	const parts: string[] = [];
	if (detail.used !== undefined && detail.size !== undefined) {
		parts.push(formatContextUsage(detail.used, detail.size));
	}
	const amount = detail.cost?.amount;
	if (amount !== undefined) {
		parts.push(formatUsageCost(amount, detail.cost?.currency ?? "USD"));
	}
	if (parts.length === 0) {
		return null;
	}
	return (
		<div className="mx-auto w-full max-w-3xl px-3 pb-1 sm:px-4">
			<p className="text-right text-muted-foreground/70 text-xs tabular-nums">
				{parts.join(" · ")}
			</p>
		</div>
	);
}
