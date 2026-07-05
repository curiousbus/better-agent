// Pure display formatters for the `turn_usage` chip and `session_ready`
// header — kept out of the components so the rounding/threshold choices are
// unit-testable without rendering anything.

const COST_DECIMAL_PLACES = 4;

/** `$0.0123` — always four decimal places, since a single turn's cost is
 * routinely sub-cent and a rounded `$0.01` would hide most of the signal. */
export function formatCostUsd(costUsd: number): string {
	return `$${costUsd.toFixed(COST_DECIMAL_PLACES)}`;
}

const TOKEN_COMPACT_THRESHOLD = 1000;
const TOKEN_COMPACT_DIVISOR = 1000;
const TOKEN_COMPACT_DECIMALS = 1;

/** Compact token count: `847` stays as-is, `1200` becomes `1.2k`. */
export function formatTokenCount(count: number): string {
	if (count < TOKEN_COMPACT_THRESHOLD) {
		return String(count);
	}
	return `${(count / TOKEN_COMPACT_DIVISOR).toFixed(TOKEN_COMPACT_DECIMALS)}k`;
}

const CWD_MAX_LENGTH = 40;

/** Truncates a long cwd path from the front (keeping the tail — the part
 * that actually distinguishes one project directory from another) so the
 * header never wraps or overflows the pill row. Callers should also set
 * `title` to the untruncated path. */
export function truncateCwd(cwd: string): string {
	if (cwd.length <= CWD_MAX_LENGTH) {
		return cwd;
	}
	return `…${cwd.slice(cwd.length - CWD_MAX_LENGTH)}`;
}
