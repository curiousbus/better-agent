import { expect, it } from "vitest";
import { asNode, nodeComplete, readRoot } from "./genui-tree";

it("reads the root wrapper or passes through", () => {
	expect(readRoot({ root: { id: "a" } })).toEqual({ id: "a" });
	expect(readRoot({ id: "b" })).toEqual({ id: "b" });
	expect(readRoot(null)).toBeNull();
});

it("treats a node as complete only with string id and type", () => {
	expect(nodeComplete({ id: "a", type: "Card" })).toBe(true);
	expect(nodeComplete({ id: "a" })).toBe(false);
	expect(nodeComplete("x")).toBe(false);
});

it("asNode returns a partial node or null", () => {
	expect(asNode({ type: "Card" })?.type).toBe("Card");
	expect(asNode(42)).toBeNull();
});
