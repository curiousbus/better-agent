import { expect, it } from "vitest";
import {
	formatCostUsd,
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

it("leaves a short cwd untouched", () => {
	expect(truncateCwd("/repo")).toBe("/repo");
});

it("truncates a long cwd from the front, keeping the tail", () => {
	const long = "/Users/john/some/very/deeply/nested/project/directory/name";
	const result = truncateCwd(long);
	expect(result.startsWith("…")).toBe(true);
	expect(long.endsWith(result.slice(1))).toBe(true);
});
