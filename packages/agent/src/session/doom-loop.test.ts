import { expect, it } from "vitest";
import { createDoomLoopGuard } from "./doom-loop";

it("blocks the third consecutive identical call", () => {
	const g = createDoomLoopGuard();
	expect(g.check("read", { p: "a" })).toBe(false);
	expect(g.check("read", { p: "a" })).toBe(false);
	expect(g.check("read", { p: "a" })).toBe(true);
});

it("resets when the call changes", () => {
	const g = createDoomLoopGuard();
	g.check("read", { p: "a" });
	g.check("read", { p: "a" });
	expect(g.check("read", { p: "b" })).toBe(false);
	expect(g.check("read", { p: "b" })).toBe(false);
	expect(g.check("read", { p: "b" })).toBe(true);
});

it("treats different tool names as distinct", () => {
	const g = createDoomLoopGuard();
	g.check("read", {});
	g.check("read", {});
	expect(g.check("glob", {})).toBe(false);
});

it("honors a custom threshold", () => {
	const g = createDoomLoopGuard(2);
	expect(g.check("x", 1)).toBe(false);
	expect(g.check("x", 1)).toBe(true);
});
