import { expect, it } from "vitest";
import type { Code } from "../api";
import { clampPage, filterCodes, PAGE_SIZE, pageCount, pageOf } from "./codes";

const make = (over: Partial<Code>): Code => ({
	id: "1",
	code: "ABC",
	label: "",
	source: "",
	active: true,
	redemptions: 0,
	maxRedemptions: 1,
	...over,
});

it("filters by code/label/source case-insensitively", () => {
	const codes = [
		make({ code: "ALPHA" }),
		make({ id: "2", code: "BETA", label: "promo" }),
	];
	expect(filterCodes(codes, "alp")).toHaveLength(1);
	expect(filterCodes(codes, "PROMO")).toHaveLength(1);
	expect(filterCodes(codes, "")).toHaveLength(2);
});

it("paginates and clamps", () => {
	const items = Array.from({ length: 23 }, (_, i) => i);
	expect(pageOf(items, 0)).toHaveLength(PAGE_SIZE);
	expect(pageCount(items.length)).toBe(3);
	expect(clampPage(5, items.length)).toBe(2);
	expect(clampPage(-1, items.length)).toBe(0);
});
