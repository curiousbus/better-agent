import { CoinsIcon, RepeatIcon, ZapIcon } from "lucide-react";
import type { TurnUsageDetail, TurnUsageTokens } from "./bridge-session-status";
import { formatCostUsd, formatTokenCount } from "./bridge-usage-format";

/** "1.2k in / 340 out" — plus cache figures only when the CLI reported them,
 * since prompt caching isn't always in play for a given turn. */
function tokenSummary(usage: TurnUsageTokens): string | null {
	const parts: string[] = [];
	if (usage.inputTokens !== undefined) {
		parts.push(`${formatTokenCount(usage.inputTokens)} in`);
	}
	if (usage.outputTokens !== undefined) {
		parts.push(`${formatTokenCount(usage.outputTokens)} out`);
	}
	if (usage.cacheReadInputTokens !== undefined) {
		parts.push(`${formatTokenCount(usage.cacheReadInputTokens)} cache read`);
	}
	if (usage.cacheCreationInputTokens !== undefined) {
		parts.push(
			`${formatTokenCount(usage.cacheCreationInputTokens)} cache write`
		);
	}
	return parts.length > 0 ? parts.join(" / ") : null;
}

export interface TurnUsageChipProps {
	/** The latest `turn_usage` detail, or `null` before any turn has finished
	 * — renders nothing until then. */
	detail: TurnUsageDetail | null;
}

/**
 * Subtle per-session usage line: cost, token breakdown, and turn count from
 * the curated `turn_usage` status event (see bridge-session-status.ts).
 * Metadata, not a chat message — sits under the feed, never inline with it.
 */
export function TurnUsageChip({ detail }: TurnUsageChipProps) {
	if (!detail) {
		return null;
	}
	const tokens = detail.usage ? tokenSummary(detail.usage) : null;
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1.5 text-muted-foreground text-xs">
			{detail.costUsd !== undefined && (
				<span className="flex items-center gap-1">
					<CoinsIcon className="size-3.5 shrink-0" />
					{formatCostUsd(detail.costUsd)}
				</span>
			)}
			{tokens && (
				<span className="flex items-center gap-1">
					<ZapIcon className="size-3.5 shrink-0" />
					{tokens}
				</span>
			)}
			{detail.numTurns !== undefined && (
				<span className="flex items-center gap-1">
					<RepeatIcon className="size-3.5 shrink-0" />
					{detail.numTurns} {detail.numTurns === 1 ? "turn" : "turns"}
				</span>
			)}
		</div>
	);
}
