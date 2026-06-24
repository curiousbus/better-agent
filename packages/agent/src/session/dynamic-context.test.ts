import { expect, it } from "vitest";
import { buildDynamicContext } from "./dynamic-context";

it("formats the date to day precision (UTC)", () => {
	const out = buildDynamicContext(new Date("2026-06-24T10:30:00Z"));
	expect(out).toBe("Current date: 2026-06-24");
});
