import { expect, it } from "vitest";
import { completePartialJson } from "./partial-json";

it("parses already-complete JSON", () => {
	expect(completePartialJson('{"a":1}')).toEqual({ a: 1 });
});

it("completes an unterminated string", () => {
	expect(completePartialJson('{"a":"hi')).toEqual({ a: "hi" });
});

it("completes nested open object and array", () => {
	expect(completePartialJson('{"root":{"children":[{"id":"x"')).toEqual({
		root: { children: [{ id: "x" }] },
	});
});

it("drops a dangling key with no value", () => {
	expect(completePartialJson('{"a":1,"b"')).toEqual({ a: 1 });
});

it("returns undefined for unusable input", () => {
	expect(completePartialJson("")).toBeUndefined();
	expect(completePartialJson("not json")).toBeUndefined();
});
