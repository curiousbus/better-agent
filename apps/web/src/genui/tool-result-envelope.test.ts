import { expect, it } from "vitest";
import { unwrapToolResult } from "./tool-result-envelope";

it("passes through an already-parsed object as-is", () => {
	const value = { a: 1 };
	expect(unwrapToolResult(value)).toBe(value);
});

it("parses a bare JSON string", () => {
	expect(unwrapToolResult('{"a":1}')).toEqual({ a: 1 });
});

it("unwraps the MCP content envelope's JSON text", () => {
	const envelope = {
		content: [{ text: '{"a":1}', type: "text" }],
		isError: false,
	};
	expect(unwrapToolResult(envelope)).toEqual({ a: 1 });
});

it("returns undefined for malformed JSON in a bare string", () => {
	expect(unwrapToolResult("not json{")).toBeUndefined();
});

it("returns undefined for malformed JSON inside the MCP envelope", () => {
	const envelope = { content: [{ text: "not json{", type: "text" }] };
	expect(unwrapToolResult(envelope)).toBeUndefined();
});

it("returns undefined when the MCP envelope has no text content", () => {
	const envelope = { content: [{ type: "text" }] };
	expect(unwrapToolResult(envelope)).toBeUndefined();
});
