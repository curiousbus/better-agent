import type {
	UsageUpdateCost,
	UsageUpdateDetail,
} from "./bridge-session-status";
import { formatContextUsage, formatCostCompact } from "./bridge-usage-format";

/** Cost figure from opencode's `usage_update` — `amount` + ISO `currency`,
 * which always travel together so this takes the whole `UsageUpdateCost`. USD
 * uses the compact `$0.045` form; a non-USD currency falls back to a plain
 * `amount + code` so nothing is silently mislabeled. Returns null when there's
 * no amount to show. */
function formatUsageCost(cost: UsageUpdateCost): string | null {
	if (cost.amount === undefined) {
		return null;
	}
	const currency = cost.currency ?? "USD";
	return currency === "USD"
		? formatCostCompact(cost.amount)
		: `${cost.amount} ${currency}`;
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
	const cost = detail.cost === undefined ? null : formatUsageCost(detail.cost);
	if (cost !== null) {
		parts.push(cost);
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
