import { expect, it } from "vitest";
import {
	formatCostUsd,
	formatDurationMs,
	formatTokenCount,
	truncateCwd,
} from "./bridge-usage-format";

it("formats cost to four decimal places", () => {
	expect(formatCostUsd(0.012_345)).toBe("$0.0123");
	expect(formatCostUsd(1)).toBe("$1.0000");
});

it("keeps sub-1000 token counts exact", () => {
	expect(formatTokenCount(847)).toBe("847");
	expect(formatTokenCount(0)).toBe("0");
});

it("compacts token counts of 1000 or more to one decimal 'k'", () => {
	expect(formatTokenCount(1234)).toBe("1.2k");
	expect(formatTokenCount(15_000)).toBe("15.0k");
});

it("formats a sub-minute duration as seconds with one decimal", () => {
	expect(formatDurationMs(4500)).toBe("4.5s");
	expect(formatDurationMs(950)).toBe("0.9s");
});

it("formats a duration past a minute as minutes and seconds", () => {
	expect(formatDurationMs(65_000)).toBe("1m 5s");
	expect(formatDurationMs(125_000)).toBe("2m 5s");
});

it("leaves a short cwd untouched", () => {
	expect(truncateCwd("/repo")).toBe("/repo");
});

it("truncates a long cwd from the front, keeping the tail", () => {
	const long = "/Users/john/some/very/deeply/nested/project/directory/name";
	const result = truncateCwd(long);
	expect(result.startsWith("…")).toBe(true);
	expect(long.endsWith(result.slice(1))).toBe(true);
});
