import { expect, it } from "vitest";
import {
	applySlashPickerSelection,
	buildSlashPickerItems,
	clampActiveIndex,
	parseSlashQuery,
} from "./slash-picker";

it("recognizes a bare slash or a slash-prefixed query with no space yet", () => {
	expect(parseSlashQuery("/")).toBe("");
	expect(parseSlashQuery("/co")).toBe("co");
});

it("stops recognizing a query once a space follows the slash", () => {
	expect(parseSlashQuery("/co ")).toBeNull();
	expect(parseSlashQuery("/co bar")).toBeNull();
});

it("does not treat a slash elsewhere in the text as a query", () => {
	expect(parseSlashQuery("hello /foo")).toBeNull();
	expect(parseSlashQuery("hello")).toBeNull();
	expect(parseSlashQuery("")).toBeNull();
});

it("filters commands then skills by case-insensitive prefix, dropping non-matches", () => {
	const items = buildSlashPickerItems(
		{ commands: ["compact", "clear"], skills: ["pdf", "compare-docs"] },
		"co"
	);
	expect(items).toEqual([
		{ kind: "command", name: "compact" },
		{ kind: "skill", name: "compare-docs" },
	]);
});

it("matches an empty query against everything (a bare '/')", () => {
	const items = buildSlashPickerItems(
		{ commands: ["compact"], skills: ["pdf"] },
		""
	);
	expect(items).toEqual([
		{ kind: "command", name: "compact" },
		{ kind: "skill", name: "pdf" },
	]);
});

it("tolerates a leading slash already present on a reported name", () => {
	const items = buildSlashPickerItems({ commands: ["/compact"] }, "co");
	expect(items).toEqual([{ kind: "command", name: "compact" }]);
});

it("contributes nothing for a capability list the session hasn't reported", () => {
	expect(buildSlashPickerItems({}, "")).toEqual([]);
	expect(buildSlashPickerItems({ commands: ["compact"] }, "")).toEqual([
		{ kind: "command", name: "compact" },
	]);
});

it("fills the composer with the bare command, trailing space for args", () => {
	expect(applySlashPickerSelection({ kind: "command", name: "compact" })).toBe(
		"/compact "
	);
	expect(applySlashPickerSelection({ kind: "skill", name: "pdf" })).toBe(
		"/pdf "
	);
});

it("clamps and wraps the active index around the item count", () => {
	const itemCount = 3;
	const lastIndex = itemCount - 1;
	expect(clampActiveIndex(0, itemCount)).toBe(0);
	expect(clampActiveIndex(lastIndex, itemCount)).toBe(lastIndex);
	expect(clampActiveIndex(itemCount, itemCount)).toBe(0);
	expect(clampActiveIndex(-1, itemCount)).toBe(lastIndex);
	expect(clampActiveIndex(0, 0)).toBe(0);
	expect(clampActiveIndex(-1, 0)).toBe(0);
});
